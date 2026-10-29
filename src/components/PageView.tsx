import { memo, useEffect, useRef, useState } from 'react';
import { pdfjs, type PDFDocumentProxy } from '../lib/pdfjs';
import { paintMatches, type Match } from '../lib/search';
import type { Annot, PageSize } from '../lib/types';
import { AnnotLayer } from './AnnotLayer';

// iOS Safari refuses canvases above ~16.7M pixels.
const MAX_PIXELS = 16_000_000;
const BASE_WHEN_TILED = 3_000_000;

interface Props {
  pdf: PDFDocumentProxy;
  version: number;
  index: number;
  size: PageSize;
  scale: number;
  near: boolean;
  annots: Annot[];
  matches: Match[];
  current: Match | null;
  label: string;
  editing: string | null;
  setEditing: (id: string | null) => void;
}

/** Rectangle of the page in PDF points, top-left origin. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const deviceRatio = () => Math.min(devicePixelRatio || 1, 3);

export const PageView = memo(function PageView(p: Props) {
  const pageRef = useRef<HTMLDivElement>(null);
  const regionCanvas = useRef<HTMLCanvasElement>(null);
  const wanted = useRef<Rect | null>(null);
  const [region, setRegion] = useState<Rect | null>(null);
  const [shown, setShown] = useState<Rect | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<InstanceType<typeof pdfjs.TextLayer> | null>(null);
  const [textReady, setTextReady] = useState(0);
  const [renderScale, setRenderScale] = useState(p.scale);

  // Re-render the bitmap only after zooming settles; CSS stretches it meanwhile.
  useEffect(() => {
    const t = setTimeout(() => setRenderScale(p.scale), 160);
    return () => clearTimeout(t);
  }, [p.scale]);

  useEffect(() => {
    if (!p.near) {
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await p.pdf.getPage(p.index + 1);
      if (cancelled) return;
      let s = renderScale * Math.min(devicePixelRatio || 1, 3);
      const vp1 = page.getViewport({ scale: 1 });
      const px = vp1.width * vp1.height * s * s;
      // When the sharp tile covers the visible part, this full-page layer is only a quick placeholder.
      const budget = px > MAX_PIXELS ? BASE_WHEN_TILED : MAX_PIXELS;
      if (px > budget) s *= Math.sqrt(budget / px);
      const viewport = page.getViewport({ scale: s });
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = page.render({ canvas: off, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      const c = canvasRef.current;
      if (!c) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      off.width = 0;
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [p.pdf, p.index, p.near, renderScale, p.version]);

  // A whole page at high zoom would exceed the browser's canvas limit and be drawn blurry.
  // In that case only the visible part (plus a margin) is drawn at full resolution on top.
  const tiled = p.size.width * p.size.height * (renderScale * deviceRatio()) ** 2 > MAX_PIXELS;

  useEffect(() => {
    const el = pageRef.current;
    const root = el?.closest('.viewer');
    wanted.current = null;
    if (!el || !root || !p.near || !tiled) {
      setRegion(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const pr = el.getBoundingClientRect();
      const vr = root.getBoundingClientRect();
      const k = 1 / p.scale; // screen px → points
      const x0 = Math.max(0, (vr.left - pr.left) * k);
      const y0 = Math.max(0, (vr.top - pr.top) * k);
      const x1 = Math.min(p.size.width, (vr.right - pr.left) * k);
      const y1 = Math.min(p.size.height, (vr.bottom - pr.top) * k);
      if (x1 <= x0 || y1 <= y0) {
        wanted.current = null;
        setRegion(null);
        return;
      }
      const cur = wanted.current;
      if (cur && x0 >= cur.x && y0 >= cur.y && x1 <= cur.x + cur.w && y1 <= cur.y + cur.h) return;
      const px = (x1 - x0) * 0.3;
      const py = (y1 - y0) * 0.3;
      const rx = Math.max(0, x0 - px);
      const ry = Math.max(0, y0 - py);
      const next = { x: rx, y: ry, w: Math.min(p.size.width, x1 + px) - rx, h: Math.min(p.size.height, y1 + py) - ry };
      wanted.current = next;
      setRegion(next);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 90);
    };
    update();
    root.addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => {
      clearTimeout(timer);
      root.removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
    };
  }, [p.near, tiled, p.scale, p.size.width, p.size.height]);

  useEffect(() => {
    const c = regionCanvas.current;
    if (!c) return;
    if (!region || !tiled || !p.near) {
      c.width = 0;
      c.height = 0;
      setShown(null);
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await p.pdf.getPage(p.index + 1);
      if (cancelled) return;
      let s = renderScale * deviceRatio();
      const px = region.w * region.h * s * s;
      if (px > MAX_PIXELS) s *= Math.sqrt(MAX_PIXELS / px);
      const viewport = page.getViewport({ scale: s, offsetX: -region.x * s, offsetY: -region.y * s });
      const off = document.createElement('canvas');
      off.width = Math.ceil(region.w * s);
      off.height = Math.ceil(region.h * s);
      task = page.render({ canvas: off, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      off.width = 0;
      setShown(region);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [region, renderScale, tiled, p.near, p.pdf, p.index, p.version]);

  // Text layer (selection + search) is laid out at scale 1 and zoomed via the CSS scale factor.
  useEffect(() => {
    if (!p.near) return;
    let cancelled = false;
    const el = textRef.current!;
    (async () => {
      const page = await p.pdf.getPage(p.index + 1);
      const tc = await page.getTextContent();
      if (cancelled) return;
      el.replaceChildren();
      const layer = new pdfjs.TextLayer({ textContentSource: tc, container: el, viewport: page.getViewport({ scale: 1 }) });
      layerRef.current = layer;
      await layer.render();
      if (!cancelled) setTextReady((n) => n + 1);
    })().catch(() => {});
    return () => {
      cancelled = true;
      layerRef.current?.cancel();
      layerRef.current = null;
    };
  }, [p.pdf, p.index, p.near, p.version]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    paintMatches(layer.textDivs, layer.textContentItemsStr, p.matches, p.current);
    if (p.current) textRef.current?.querySelector('mark.current')?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [p.matches, p.current, textReady]);

  const w = p.size.width * p.scale;
  const h = p.size.height * p.scale;

  return (
    <div
      ref={pageRef}
      className="page"
      data-page={p.index}
      style={{ width: w, height: h, ['--total-scale-factor' as string]: p.scale, ['--scale-factor' as string]: p.scale }}
    >
      <canvas ref={canvasRef} className="page-canvas" />
      <canvas
        ref={regionCanvas}
        className="page-region"
        style={shown ? { left: shown.x * p.scale, top: shown.y * p.scale, width: shown.w * p.scale, height: shown.h * p.scale } : { display: 'none' }}
      />
      <div ref={textRef} className="textLayer" />
      {p.near && (
        <AnnotLayer page={p.index} size={p.size} annots={p.annots} editing={p.editing} setEditing={p.setEditing} />
      )}
      <span className="page-label">{p.label}</span>
    </div>
  );
});
