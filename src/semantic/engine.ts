import type { PDFPage, PDFTextContent } from '../types/pdf.js';
import type { PageTextRegionLayout } from '../core/layout/types.js';
import { RegionLayoutAnalyzer } from '../core/region-layout.js';
import type { ColumnDetection, SemanticFragment, TableDetection, TableRowDetection } from './types.js';

const buildPseudoPage = (items: PDFTextContent[]): PDFPage => {
  const safe = items.filter((t) => t && typeof t.x === 'number' && typeof t.y === 'number');
  const maxX = safe.length > 0 ? Math.max(...safe.map((t) => t.x + Math.max(0, t.width))) : 0;
  const maxY = safe.length > 0 ? Math.max(...safe.map((t) => t.y + Math.max(0, t.height))) : 0;
  const width = Math.max(1, Math.ceil(maxX + 1));
  const height = Math.max(1, Math.ceil(maxY + 1));

  return {
    pageNumber: 1,
    width,
    height,
    content: {
      text: items,
      images: [],
      graphics: [],
      forms: [],
      annotations: []
    }
  };
};

export const analyzeText = (
  items: PDFTextContent[],
  analyzer?: RegionLayoutAnalyzer
): { page: PDFPage; analysis: PageTextRegionLayout; analyzer: RegionLayoutAnalyzer } => {
  const page = buildPseudoPage(items);
  const a = analyzer ?? new RegionLayoutAnalyzer();
  const analysis = a.analyze(page);
  return { page, analysis, analyzer: a };
};

export const buildFragmentsFromAnalysis = (analysis: PageTextRegionLayout): SemanticFragment[] => {
  const frags: SemanticFragment[] = [];

  for (const line of analysis.lines) {
    const runs = Array.isArray(line.mergedRuns) && line.mergedRuns.length > 0 ? line.mergedRuns : [];
    for (const r of runs) {
      frags.push({
        text: r.text,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        font: {
          family: r.fontFamily,
          size: r.fontSize,
          weight: r.fontWeight,
          style: r.fontStyle,
          color: r.color
        }
      });
    }
  }

  return frags;
};

const mode = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
};

export const detectColumnsFromAnalysis = (analysis: PageTextRegionLayout, items: PDFTextContent[]): ColumnDetection | null => {
  const centers = analysis.stats?.layout.columnPositions?.filter((x) => Number.isFinite(x)) ?? [];
  const unique = [...new Set(centers.map((x) => Math.round(x)))].sort((a, b) => a - b);
  if (unique.length < 2) return null;

  const cols = unique.map((x) => ({ x, items: [] as PDFTextContent[] }));
  const nearestIdx = (x: number): number => {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cols.length; i++) {
      const d = Math.abs(x - cols[i]!.x);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  for (const t of items) {
    const idx = nearestIdx(t.x);
    cols[idx]!.items.push(t);
  }

  const columns = cols
    .map((c) => {
      const xs = c.items.map((t) => t.x);
      const x2 = c.items.map((t) => t.x + Math.max(0, t.width));
      const minX = xs.length > 0 ? Math.min(...xs) : c.x;
      const maxX = x2.length > 0 ? Math.max(...x2) : c.x;
      return {
        x: minX,
        width: Math.max(0, maxX - minX),
        content: c.items
      };
    })
    .filter((c) => c.content.length > 0)
    .sort((a, b) => a.x - b.x);

  if (columns.length < 2) return null;
  return {
    columns,
    columnCount: columns.length
  };
};

export const detectColumns = (items: PDFTextContent[]): ColumnDetection | null => {
  if (!items || items.length === 0) return null;
  const { analysis } = analyzeText(items);
  return detectColumnsFromAnalysis(analysis, items);
};

export const detectTableFromAnalysis = (analysis: PageTextRegionLayout): TableDetection | null => {
  const lines = analysis.lines;
  if (!lines || lines.length < 2) return null;

  const rows: TableRowDetection[] = [];
  const rowCounts: number[] = [];

  for (const line of lines) {
    const runs = Array.isArray(line.mergedRuns) ? [...line.mergedRuns].sort((a, b) => a.x - b.x) : [];
    if (runs.length < 2) continue;

    rows.push({
      cells: runs.map((r) => ({
        items: [],
        text: r.text,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height
      }))
    });
    rowCounts.push(runs.length);
  }

  if (rows.length < 2) return null;

  const common = mode(rowCounts);
  if (!common || common < 2) return null;

  const normalizedRows = rows.filter((r) => r.cells.length === common);
  if (normalizedRows.length < 2) return null;

  const colCount = common;
  let totalScore = 0;
  for (let col = 0; col < colCount; col++) {
    const xs = normalizedRows.map((r) => r.cells[col]!.x);
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((sum, x) => sum + (x - avg) ** 2, 0) / xs.length;
    totalScore += 1 / (1 + variance);
  }
  const alignmentScore = totalScore / colCount;
  if (alignmentScore < 0.5) return null;

  const allItems = analysis.regions.flatMap((r) => r.lines.flatMap((l) => l.items));

  return {
    rows: normalizedRows,
    columnCount: colCount,
    items: allItems
  };
};

export const detectTable = (items: PDFTextContent[]): TableDetection | null => {
  if (!items || items.length === 0) return null;
  const { analysis } = analyzeText(items);
  return detectTableFromAnalysis(analysis);
};
