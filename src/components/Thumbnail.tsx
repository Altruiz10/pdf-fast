import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../lib/pdfjs';

/** Lazily rendered page preview, `width` CSS pixels wide. */
export const Thumbnail = memo(function Thumbnail({
  pdf,
  version,
  index,
  width,
  aspect,
}: {
  pdf: PDFDocumentProxy;
  version: number;
  index: number;
  width: number;
  aspect: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await pdf.getPage(index + 1);
      if (cancelled) return;
      const vp1 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width * Math.min(devicePixelRatio, 2)) / vp1.width });
      const c = ref.current!;
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
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, version, index, width, visible]);

  return <canvas ref={ref} className="thumb-canvas" style={{ width: '100%', maxWidth: width, aspectRatio: `1 / ${aspect}` }} />;
});
