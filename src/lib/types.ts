// Annotation coordinates are in page display space at scale 1 (PDF points),
// origin top-left, after the page's own rotation — the same space as
// pdf.js `page.getViewport({ scale: 1 })`.

export type Tool =
  | 'select'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'text'
  | 'note'
  | 'redact';

interface Base {
  id: string;
  page: number; // 0-based
  color: string;
}

export interface BoxAnnot extends Base {
  type: 'highlight' | 'rect' | 'ellipse' | 'redact';
  x: number;
  y: number;
  w: number;
  h: number;
  width: number; // stroke width
}

export interface LineAnnot extends Base {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export interface InkAnnot extends Base {
  type: 'ink';
  points: [number, number][];
  width: number;
}

export interface TextAnnot extends Base {
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  size: number;
}

export interface NoteAnnot extends Base {
  type: 'note';
  x: number;
  y: number;
  text: string;
}

export interface ImageAnnot extends Base {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // PNG data URL
}

export type Annot = BoxAnnot | LineAnnot | InkAnnot | TextAnnot | NoteAnnot | ImageAnnot;

export interface Snapshot {
  bytes: Uint8Array;
  annots: Annot[];
  label: string;
}

export interface PageSize {
  width: number;
  height: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
