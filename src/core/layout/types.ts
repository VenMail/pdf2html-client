import type { PDFTextContent } from '../../types/pdf.js';

export type Rect = { left: number; top: number; width: number; height: number };

export type TextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: PDFTextContent['fontStyle'];
  color: string;
  rotation?: number;
};

export type TextLine = {
  items: PDFTextContent[];
  mergedRuns: TextRun[];
  rect: Rect;
  minX: number;
  maxX: number;
  topPdf: number;
  height: number;
  hasRotation: boolean;
  avgFontSize: number;
  dominantFont: string;
};

export type TextRegion = {
  lines: TextLine[];
  paragraphs: Array<{
    lines: Array<{
      text: string;
      indent: number;
      sourceLine?: TextLine;
      joinWithPrev?: 'hyphenation' | 'continuation';
    }>;
    top: number;
    gapBefore: number;
    dominant: PDFTextContent;
    lineHeight: number;
  }>;
  rect: Rect;
  minX: number;
  maxX: number;
  top: number;
  bottom: number;
  flowAllowed: boolean;
  overlapsObstacle: boolean;
  nearestObstacleDistance: number;
};

export type GapStatistics = {
  characterGaps: number[];
  wordGaps: number[];
  lineGaps: number[];
  paragraphGaps: number[];
  medianCharGap: number;
  medianWordGap: number;
  medianLineGap: number;
  medianParagraphGap: number;
  p25WordGap: number;
  p75WordGap: number;
};

export type FontStatistics = {
  fontSizes: Map<number, number>;
  fontFamilies: Map<string, number>;
  dominantFontSize: number;
  dominantFontFamily: string;
  fontSizeVariance: number;
};

export type LayoutStatistics = {
  leftMargins: number[];
  rightMargins: number[];
  columnPositions: number[];
  indentLevels: number[];
  medianLeftMargin: number;
  commonIndents: number[];
};

export type DocumentStatistics = {
  gaps: GapStatistics;
  fonts: FontStatistics;
  layout: LayoutStatistics;
  medianHeight: number;
  medianFontSize: number;
  pageWidth: number;
  pageHeight: number;
  textDensity: number;
  averageWordsPerLine: number;
};

export type PageTextRegionLayout = {
  regions: TextRegion[];
  lines: TextLine[];
  medianFontSize: number;
  medianHeight: number;
  stats?: DocumentStatistics;
};

export type Obstacles = {
  soft: Rect[];
  hard: Rect[];
};
