import { memo, useEffect, useRef, useState } from 'react';
import { pdfjs, type PDFDocumentProxy } from '../lib/pdfjs';
import { paintMatches, type Match } from '../lib/search';
import type { Annot, PageSize } from '../lib/types';
import { AnnotLayer } from './AnnotLayer';

// iOS Safari refuses canvases above ~16.7M pixels.
const MAX_PIXELS = 16_000_000;

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

export const PageView = memo(function PageView(p: Props) {
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
      if (px > MAX_PIXELS) s *= Math.sqrt(MAX_PIXELS / px);
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
      className="page"
      data-page={p.index}
      style={{ width: w, height: h, ['--total-scale-factor' as string]: p.scale, ['--scale-factor' as string]: p.scale }}
    >
      <canvas ref={canvasRef} className="page-canvas" />
      <div ref={textRef} className="textLayer" />
      {p.near && (
        <AnnotLayer page={p.index} size={p.size} annots={p.annots} editing={p.editing} setEditing={p.setEditing} />
      )}
      <span className="page-label">{p.label}</span>
    </div>
  );
});
