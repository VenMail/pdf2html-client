import type { PDFTextContent } from '../types/pdf.js';

export type SemanticFragment = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: {
    family: string;
    size: number;
    weight: number;
    style: PDFTextContent['fontStyle'];
    color: string;
  };
  source?: {
    pageNumber?: number;
  };
};

export type ColumnDetection = {
  columns: Array<{
    x: number;
    width: number;
    content: PDFTextContent[];
  }>;
  columnCount: number;
};

export type TableCellDetection = {
  items: PDFTextContent[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TableRowDetection = {
  cells: TableCellDetection[];
};

export type TableDetection = {
  rows: TableRowDetection[];
  columnCount: number;
  items: PDFTextContent[];
};
