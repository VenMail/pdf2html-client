export interface PDFDocument {
  pageCount: number;
  metadata: PDFMetadata;
  pages: PDFPage[];
}

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

export interface PDFPage {
  pageNumber: number;
  width: number;
  height: number;
  content: PDFContent;
}

export interface PDFContent {
  text: PDFTextContent[];
  images: PDFImageContent[];
  graphics: PDFGraphicsContent[];
  forms: PDFFormContent[];
  annotations: PDFAnnotation[];
}

export interface PDFTextContent {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  color: string;
  fontInfo?: PDFFontInfo;
  rotation?: number;
}

export interface PDFFontInfo {
  name: string;
  embedded: boolean;
  subset: boolean;
  encoding: string;
  metrics: PDFFontMetrics;
}

export interface PDFFontMetrics {
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  averageWidth: number;
  maxWidth: number;
}

export interface PDFImageContent {
  data: ArrayBuffer | string;
  format: 'jpeg' | 'png' | 'gif' | 'webp';
  x: number;
  y: number;
  width: number;
  height: number;
  dpi?: number;
  rotation?: number;
  matrix?: [number, number, number, number, number, number];
  filters?: string[];
  rawData?: ArrayBuffer;
  decodedData?: ArrayBuffer;
  pixelWidth?: number;
  pixelHeight?: number;
  bitsPerPixel?: number;
  colorSpace?: number;
}

export interface PDFGraphicsContent {
  type: 'path' | 'rectangle' | 'circle' | 'line' | 'curve' | 'raster';
  path?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  fillRule?: 'nonzero' | 'evenodd';
  strokeWidth?: number;
  strokeOpacity?: number;
  fillOpacity?: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
  // For raster fallback graphics
  data?: string;
}

export interface PDFFormContent {
  type: 'text' | 'checkbox' | 'radio' | 'button' | 'dropdown';
  name: string;
  value: string | boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  readonly?: boolean;
}

export interface PDFAnnotation {
  type: 'link' | 'note' | 'highlight' | 'underline' | 'strikeout';
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  url?: string;
}

export interface PDFParserOptions {
  extractText: boolean;
  extractImages: boolean;
  extractGraphics: boolean;
  extractForms: boolean;
  extractAnnotations: boolean;
  maxConcurrentPages?: number;
}


