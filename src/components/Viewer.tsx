import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Highlighter } from 'lucide-react';
import { useDoc } from '../store';
import { PageView } from './PageView';
import type { Match } from '../lib/search';
import { uid, type Annot } from '../lib/types';

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

interface Props {
  scale: number;
  setScale: (s: number, anchor?: { x: number; y: number }) => void;
  zoomMode: ZoomMode;
  setZoomMode: (m: ZoomMode) => void;
  matches: Match[];
  current: Match | null;
  layout: 'continuous' | 'single' | 'two-up';
  labels: string[];
  readMode: boolean;
  api: MutableRefObject<ZoomApi | null>;
}

export interface ZoomApi {
  /** Zooms to an absolute scale, keeping the centre of the view in place. */
  zoomTo: (scale: number) => void;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;
export const clampZoom = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));

export function Viewer({ scale, setScale, zoomMode, setZoomMode, matches, current, layout, labels, readMode, api }: Props) {
  const { doc, jumpTo, setCurrentPage, currentPage, tool, setSelected, setAnnots, goToPage } = useDoc();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<Set<number>>(new Set([0, 1, 2]));
  const [editing, setEditing] = useState<string | null>(null);
  const [selRect, setSelRect] = useState<{ x: number; y: number } | null>(null);
  const pendingAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);

  const sizes = doc?.sizes ?? [];
  // Fit to the most common page size, so one landscape page doesn't shrink all the portrait ones.
  const [maxW, maxH] = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of sizes) {
      const k = `${Math.round(s.width)}x${Math.round(s.height)}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '1x1';
    const [w, h] = top.split('x').map(Number);
    return [Math.max(1, w), Math.max(1, h)];
  }, [sizes]);

  // Fit modes follow the container size (phone rotation, sidebar toggles).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || zoomMode === 'custom') return;
    const fit = () => {
      const pad = innerWidth < 700 ? 16 : 48;
      const cols = layout === 'two-up' ? 2 : 1;
      const w = (el.clientWidth - pad - (cols - 1) * 12) / (maxW * cols);
      const h = (el.clientHeight - pad) / maxH;
      setScale(clampZoom(zoomMode === 'fit-page' ? Math.min(w, h) : w));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomMode, maxW, maxH, layout, setScale]);

  // Track which pages are near the viewport (render them) and which one is current.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !doc) return;
    const ratios = new Map<number, number>();
    const nearIO = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const i = +(e.target as HTMLElement).dataset.page!;
            if (e.isIntersecting) next.add(i);
            else next.delete(i);
          }
          return next;
        });
      },
      { root, rootMargin: '150% 0px' },
    );
    const curIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(+(e.target as HTMLElement).dataset.page!, e.intersectionRatio);
        let best = -1;
        let bestR = 0;
        for (const [i, r] of ratios) if (r > bestR) [best, bestR] = [i, r];
        if (best >= 0) setCurrentPage(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll<HTMLElement>('.page').forEach((el) => {
      nearIO.observe(el);
      curIO.observe(el);
    });
    return () => {
      nearIO.disconnect();
      curIO.disconnect();
    };
  }, [doc, layout, layout === 'single' ? currentPage : -1, setCurrentPage]);

  useEffect(() => {
    if (!jumpTo) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`.page[data-page="${jumpTo.page}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, [jumpTo]);

  // Keep the point under the fingers/cursor fixed while zooming.
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    el.scrollLeft = a.fx * el.scrollWidth - a.cx;
    el.scrollTop = a.fy * el.scrollHeight - a.cy;
    pendingAnchor.current = null;
  }, [scale]);

  const zoomAt = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      const cx = clientX - r.left;
      const cy = clientY - r.top;
      pendingAnchor.current = {
        fx: (el.scrollLeft + cx) / el.scrollWidth,
        fy: (el.scrollTop + cy) / el.scrollHeight,
        cx,
        cy,
      };
      setZoomMode('custom');
      setScale(clampZoom(next));
    },
    [setScale, setZoomMode],
  );

  // Lets the zoom buttons and shortcuts zoom around the centre of what is on screen.
  useEffect(() => {
    api.current = {
      zoomTo: (s) => {
        const r = scrollRef.current!.getBoundingClientRect();
        zoomAt(s, r.left + r.width / 2, r.top + r.height / 2);
      },
    };
    return () => {
      api.current = null;
    };
  }, [api, zoomAt]);

  // Double-tap: jump between "fit to width" and a comfortable reading size around the tapped spot.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || tool !== 'select') return;
    let last = { t: 0, x: 0, y: 0 };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      if ((e.target as Element).closest('[data-annot], button, textarea, input')) return;
      const now = Date.now();
      if (now - last.t < 300 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 24) {
        getSelection()?.removeAllRanges();
        if (zoomMode === 'fit-width' && scale < 2) zoomAt(Math.max(scale * 2.2, 1.6), t.clientX, t.clientY);
        else setZoomMode('fit-width');
        last = { t: 0, x: 0, y: 0 };
      } else last = { t: now, x: t.clientX, y: t.clientY };
    };
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => el.removeEventListener('touchend', onEnd);
  }, [tool, zoomMode, scale, zoomAt, setZoomMode]);

  // Ctrl/⌘ + wheel and trackpad pinch on desktop.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(scale * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, zoomAt]);

  // Two-finger pinch on touch screens.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startDist = 0;
    let startScale = scale;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
        startScale = scale;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAt(startScale * (dist(e.touches) / startDist), cx, cy);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = 0;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [scale, zoomAt]);

  // Offer "Highlight" for selected text.
  useEffect(() => {
    const onSel = () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !scrollRef.current?.contains(sel.anchorNode)) return setSelRect(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const box = scrollRef.current.getBoundingClientRect();
      setSelRect({ x: r.left + r.width / 2 - box.left, y: r.top - box.top });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const highlightSelection = () => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !doc) return;
    const created: Annot[] = [];
    for (const rect of sel.getRangeAt(0).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const pageEl = [...scrollRef.current!.querySelectorAll<HTMLElement>('.page')].find((p) => {
        const b = p.getBoundingClientRect();
        return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
      });
      if (!pageEl) continue;
      const pi = +pageEl.dataset.page!;
      const b = pageEl.getBoundingClientRect();
      const k = doc.sizes[pi].width / b.width;
      created.push({
        id: uid(),
        type: 'highlight',
        page: pi,
        color: '#fde047',
        x: (rect.left - b.left) * k,
        y: (rect.top - b.top) * k,
        w: rect.width * k,
        h: rect.height * k,
        width: 0,
      });
    }
    if (created.length) setAnnots([...doc.annots, ...created], 'Destacar texto');
    sel.removeAllRanges();
    setSelRect(null);
  };

  if (!doc) return null;

  const pages = layout === 'single' ? [currentPage] : sizes.map((_, i) => i);
  const byPage = new Map<number, Annot[]>();
  for (const a of doc.annots) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);
  const matchesByPage = new Map<number, Match[]>();
  for (const m of matches) matchesByPage.set(m.page, [...(matchesByPage.get(m.page) ?? []), m]);

  return (
    <div
      ref={scrollRef}
      className={`viewer layout-${layout}${tool !== 'select' ? ' tool-active' : ''}${readMode ? ' read' : ''}`}
      onPointerDown={(e) => {
        if (!(e.target as Element).closest('[data-annot]')) setSelected(null);
      }}
    >
      <div className="pages">
        {pages.map((i) => (
          <PageView
            key={`${i}`}
            pdf={doc.pdf}
            version={doc.version}
            index={i}
            size={sizes[i]}
            scale={scale}
            near={layout === 'single' || near.has(i)}
            annots={byPage.get(i) ?? []}
            matches={matchesByPage.get(i) ?? []}
            current={current && current.page === i ? current : null}
            label={labels[i] ?? String(i + 1)}
            editing={editing}
            setEditing={setEditing}
          />
        ))}
      </div>
      {layout === 'single' && (
        <div className="single-nav">
          <button disabled={currentPage <= 0} onClick={() => goToPage(currentPage - 1)} aria-label="Página anterior">‹</button>
          <button disabled={currentPage >= sizes.length - 1} onClick={() => goToPage(currentPage + 1)} aria-label="Próxima página">›</button>
        </div>
      )}
      {selRect && tool === 'select' && (
        <button
          className="sel-pop"
          style={{
            left: selRect.x + (scrollRef.current?.scrollLeft ?? 0),
            top: Math.max(8, selRect.y - 44) + (scrollRef.current?.scrollTop ?? 0),
          }}
          onPointerDown={(e) => e.preventDefault()}
          onClick={highlightSelection}
        >
          <Highlighter size={16} /> Destacar
        </button>
      )}
    </div>
  );
}
