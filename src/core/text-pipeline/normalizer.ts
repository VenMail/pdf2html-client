import type { PDFTextContent } from '../../types/pdf.js';
import type { NormalizedGlyphItem } from './types.js';

function stripZeroWidth(s: string): string {
  return s
    .split('\u200B').join('')
    .split('\u200C').join('')
    .split('\u200D').join('')
    .split('\uFEFF').join('');
}

export function normalizeGlyphItems(items: PDFTextContent[]): NormalizedGlyphItem[] {
  const out: NormalizedGlyphItem[] = [];

  for (const it of items || []) {
    const raw = stripZeroWidth(it.text ?? '');
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const rotation = typeof it.rotation === 'number' && Number.isFinite(it.rotation) ? it.rotation : 0;

    out.push({
      source: it,
      text,
      x: it.x,
      y: it.y,
      width: it.width,
      height: it.height,
      fontSize: it.fontSize,
      fontFamily: it.fontFamily,
      fontWeight: it.fontWeight,
      fontStyle: it.fontStyle,
      color: it.color,
      rotation,
      baselineY: it.y
    });
  }

  out.sort((a, b) => a.x - b.x);
  return out;
}
