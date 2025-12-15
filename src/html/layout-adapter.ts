import type { HTMLGenerationOptions } from '../types/output.js';

export type LayoutAdapterOptions = NonNullable<HTMLGenerationOptions['layoutAdapter']>;

type AbsEl = {
  el: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
  lineHeight: number;
  fontSize: number;
};

const parsePx = (v: string | null | undefined): number => {
  if (!v) return 0;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const parseFontSizeAttr = (el: Element): number => {
  const raw = el.getAttribute('data-font-size');
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
};

const estimateWidth = (el: Element, fontSize: number): number => {
  const t = (el.textContent || '').replace(/\s+/g, ' ');
  const charCount = t.length;
  const avgCharW = Math.max(2, (fontSize > 0 ? fontSize : 12) * 0.55);
  return Math.max(1, Math.round(charCount * avgCharW * 1000) / 1000);
};

const estimateHeight = (fontSize: number): number => {
  const fs = fontSize > 0 ? fontSize : 12;
  return Math.max(1, Math.round(fs * 1.15 * 1000) / 1000);
};

const accumulateOffset = (el: HTMLElement, stopAt: Element): { left: number; top: number } => {
  let left = 0;
  let top = 0;
  let cur: Element | null = el;
  while (cur && cur !== stopAt) {
    if (cur instanceof HTMLElement) {
      left += parsePx(cur.style.left);
      top += parsePx(cur.style.top);
    }
    cur = cur.parentElement;
  }
  return { left, top };
};

const isAdaptableTextEl = (el: Element): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.getAttribute('data-font-family')) return false;
  const cls = el.className || '';
  if (/\bpdf-abs-gap\b/.test(cls)) return false;
  if (/\bpdf-abs-region\b/.test(cls)) return false;
  if (/\bpdf-sem-region\b/.test(cls)) return false;
  if (/\bpdf-abs-line\b/.test(cls)) return false;
  if (/\bpdf-sem-line\b/.test(cls)) return false;
  return true;
};

const clusterRows = (els: AbsEl[], rowThresholdPx: number): AbsEl[][] => {
  const sorted = [...els].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: AbsEl[][] = [];
  let current: AbsEl[] = [];
  let rowTop = Number.NaN;

  for (const e of sorted) {
    if (current.length === 0) {
      current = [e];
      rowTop = e.top;
      continue;
    }

    if (Math.abs(e.top - rowTop) <= rowThresholdPx) {
      current.push(e);
      continue;
    }

    current.sort((a, b) => a.left - b.left);
    rows.push(current);
    current = [e];
    rowTop = e.top;
  }

  if (current.length > 0) {
    current.sort((a, b) => a.left - b.left);
    rows.push(current);
  }

  return rows;
};

const stripAbsStyles = (clone: HTMLElement): void => {
  clone.style.position = 'relative';
  clone.style.left = '';
  clone.style.top = '';
};

export const adaptAbsoluteToFlex = (html: string, options: LayoutAdapterOptions): string => {
  if (!options || options.mode !== 'flex') return html;
  if (typeof DOMParser === 'undefined') return html;

  const rowThresholdPx = typeof options.rowThresholdPx === 'number' ? options.rowThresholdPx : 8;
  const minGapPx = typeof options.minGapPx === 'number' ? options.minGapPx : 0.5;
  const preserveVerticalGaps = options.preserveVerticalGaps !== false;

  const doctypeMatch = html.match(/^\s*<!doctype[^>]*>\s*/i);
  const doctypePrefix = doctypeMatch ? doctypeMatch[0] : '';
  const htmlBody = doctypePrefix ? html.slice(doctypePrefix.length) : html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlBody, 'text/html');

  const pageContainers = Array.from(doc.querySelectorAll('.pdf-abs-region, .pdf-sem-region'));
  const targets = pageContainers.length > 0
    ? pageContainers
    : Array.from(doc.querySelectorAll('.pdf-page'));

  for (const container of targets) {
    if (!(container instanceof HTMLElement)) continue;

    const candidates = Array.from(container.querySelectorAll('[style*="position: absolute"]'))
      .filter(isAdaptableTextEl)
      .filter((el) => {
        const parentLine = el.closest('.pdf-abs-line, .pdf-sem-line');
        return parentLine === null;
      });

    if (candidates.length === 0) continue;

    const abs: AbsEl[] = candidates.map((el) => {
      const { left, top } = accumulateOffset(el, container);
      const fontSize = parseFontSizeAttr(el);
      const lineHeight = parsePx(el.style.lineHeight) || estimateHeight(fontSize);
      const width = parsePx(el.style.width) || estimateWidth(el, fontSize);
      const height = Math.max(parsePx(el.style.height), lineHeight, estimateHeight(fontSize));
      return {
        el,
        left,
        top,
        width,
        height,
        lineHeight,
        fontSize
      };
    });

    const rows = clusterRows(abs, rowThresholdPx);
    if (rows.length === 0) continue;

    const flexRoot = doc.createElement('div');
    flexRoot.setAttribute('data-layout-adapter', 'flex');
    flexRoot.style.display = 'flex';
    flexRoot.style.flexDirection = 'column';
    flexRoot.style.alignItems = 'flex-start';
    flexRoot.style.gap = '0';
    flexRoot.style.position = 'relative';
    flexRoot.style.width = '100%';

    const rowMetrics = rows.map((row) => {
      const rowTop = Math.min(...row.map((e) => e.top));
      const rowHeight = Math.max(...row.map((e) => e.height));
      return { rowTop, rowHeight };
    });

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]!;
      const rowDiv = doc.createElement('div');
      rowDiv.style.display = 'flex';
      rowDiv.style.alignItems = 'flex-start';
      rowDiv.style.gap = '0';
      rowDiv.style.position = 'relative';

      let cursor = 0;
      for (const e of row) {
        const gap = e.left - cursor;
        if (gap > minGapPx) {
          const spacer = doc.createElement('div');
          spacer.className = 'pdf-abs-gap';
          spacer.style.width = `${Math.round(gap * 1000) / 1000}px`;
          spacer.style.flexShrink = '0';
          rowDiv.appendChild(spacer);
        }

        const clone = e.el.cloneNode(true) as HTMLElement;
        stripAbsStyles(clone);
        rowDiv.appendChild(clone);
        cursor = Math.max(cursor, e.left + Math.max(0, e.width));
      }

      flexRoot.appendChild(rowDiv);

      if (preserveVerticalGaps && rowIdx < rows.length - 1) {
        const cur = rowMetrics[rowIdx]!;
        const next = rowMetrics[rowIdx + 1]!;
        const vGap = next.rowTop - (cur.rowTop + cur.rowHeight);
        if (vGap > minGapPx) {
          const vSpacer = doc.createElement('div');
          vSpacer.style.height = `${Math.round(vGap * 1000) / 1000}px`;
          vSpacer.style.flexShrink = '0';
          flexRoot.appendChild(vSpacer);
        }
      }
    }

    for (const e of abs) {
      e.el.remove();
    }

    container.appendChild(flexRoot);
  }

  const out = doc.documentElement.outerHTML;
  return doctypePrefix ? `${doctypePrefix}${out}` : out;
};
