import type {
  PDFDocument,
  PDFPage,
  PDFParserOptions,
  PDFMetadata,
  PDFGraphicsContent,
  PDFImageContent
} from '../types/pdf.js';
import { PDFJSTextExtractor } from './pdfjs-text-extractor.js';
import { PDFJSImageExtractor } from './pdfjs-image-extractor.js';

type PDFJSDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PDFJSPage>;
  getMetadata: () => Promise<{ info: Record<string, unknown>; metadata: unknown }>;
};

type PDFJSPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<PDFJSTextContent>;
  getOperatorList: () => Promise<unknown>;
  getResources?: () => Promise<unknown>;
  render?: (options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => Promise<unknown>;
  objs?: { get: (name: string) => unknown };
  getAnnotations?: () => Promise<PDFJSAnnotation[]>;
};

type PDFJSTextContent = {
  items: PDFJSTextItem[];
  styles: Record<string, PDFJSFontStyle>;
};

type PDFJSTextItem = {
  str: string;
  transform: number[];
  fontName?: string;
  width?: number;
  height?: number;
  dir?: string;
};

type PDFJSFontStyle = {
  fontFamily: string;
  fontSize: number;
  fontName?: string;
};

type PDFJSAnnotation = {
  subtype?: string;
  rect?: number[];
  url?: string;
  contents?: string;
  fieldType?: string;
  fieldName?: string;
  value?: string | boolean;
};

type UnpdfModule = {
  definePDFJSModule?: (pdfjs: () => Promise<unknown>) => Promise<void>;
  getResolvedPDFJS: () => Promise<unknown>;
  getDocumentProxy: (bytes: Uint8Array) => Promise<PDFJSDocument>;
  extractImages?: (data: unknown, pageNumber: number) => Promise<ExtractedImageObject[]>;
};

type ExtractedImageObject = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  key: string;
};

let cachedUnpdf: Promise<UnpdfModule> | null = null;
let unpdfPdfjsDefined = false;

export class UnPDFWrapper {
  private document: PDFJSDocument | null = null;
  private pdfjsLib: { OPS?: Record<string, number> } | null = null;
  private textExtractor: PDFJSTextExtractor;
  private imageExtractor: PDFJSImageExtractor;

  constructor() {
    this.textExtractor = new PDFJSTextExtractor();
    this.imageExtractor = new PDFJSImageExtractor(false);
  }

  private async getUnpdf(): Promise<UnpdfModule> {
    if (!cachedUnpdf) {
      if (typeof window !== 'undefined') {
        cachedUnpdf = import('unpdf') as unknown as Promise<UnpdfModule>;
      } else {
        // Use Function constructor to avoid Vite/Vitest SSR rewriting dynamic imports into thenable modules.
        const importUnpdf = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
        cachedUnpdf = importUnpdf('unpdf') as unknown as Promise<UnpdfModule>;
      }
    }
    return await cachedUnpdf;
  }

  private async ensureOfficialPdfjs(): Promise<void> {
    if (unpdfPdfjsDefined) return;
    const unpdf = await this.getUnpdf();
    if (typeof unpdf.definePDFJSModule === 'function') {
      if (typeof window !== 'undefined') {
        const injected = (window as unknown as { __PDFJS__?: unknown }).__PDFJS__;
        if (injected) {
          await unpdf.definePDFJSModule(async () => injected);
        } else {
          await unpdf.definePDFJSModule(async () => {
            const imported = await import('pdfjs-dist');
            const pdfjs = (imported as { default?: unknown }).default || imported;
            try {
              const importWorker = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
              const workerImported = await importWorker('pdfjs-dist/build/pdf.worker.min.mjs?url');
              const workerUrl = (workerImported as { default?: unknown }).default;
              if (typeof workerUrl === 'string') {
                const withWorker = pdfjs as unknown as { GlobalWorkerOptions?: { workerSrc?: string } };
                if (withWorker?.GlobalWorkerOptions) {
                  withWorker.GlobalWorkerOptions.workerSrc = workerUrl;
                }
              }
            } catch {
              void 0;
            }
            return pdfjs;
          });
        }
      } else {
        const importPdfjs = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
        await unpdf.definePDFJSModule(() => importPdfjs('pdfjs-dist'));
      }
    }
    unpdfPdfjsDefined = true;
  }

  private async getPdfjs(): Promise<{ OPS?: Record<string, number> }> {
    if (this.pdfjsLib) return this.pdfjsLib;
    const unpdf = await this.getUnpdf();
    const resolved = await unpdf.getResolvedPDFJS();
    this.pdfjsLib = resolved as { OPS?: Record<string, number> };
    return this.pdfjsLib;
  }

  async loadDocument(data: ArrayBuffer): Promise<void> {
    await this.ensureOfficialPdfjs();
    const unpdf = await this.getUnpdf();
    const bytes = new Uint8Array(data);
    this.document = await unpdf.getDocumentProxy(bytes);
    await this.getPdfjs();
  }

  async getPageCount(): Promise<number> {
    if (!this.document) {
      throw new Error('Document not loaded');
    }
    return this.document.numPages;
  }

  async getMetadata(): Promise<PDFMetadata> {
    if (!this.document) {
      throw new Error('Document not loaded');
    }

    try {
      const metadata = await this.document.getMetadata();
      const info = metadata.info || {};

      return {
        title: info.Title as string | undefined,
        author: info.Author as string | undefined,
        subject: info.Subject as string | undefined,
        keywords: info.Keywords as string | undefined,
        creator: info.Creator as string | undefined,
        producer: info.Producer as string | undefined,
        creationDate: info.CreationDate ? new Date(info.CreationDate as string) : undefined,
        modificationDate: info.ModDate ? new Date(info.ModDate as string) : undefined
      };
    } catch (error) {
      console.warn('Failed to extract metadata:', error);
      return {};
    }
  }

  private async pixelsToPngDataUrl(pixels: Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4): Promise<string | null> {
    const rgba = new Uint8ClampedArray(width * height * 4);
    if (channels === 4) {
      rgba.set(pixels);
    } else if (channels === 3) {
      for (let i = 0, o = 0; i < pixels.length; i += 3, o += 4) {
        rgba[o] = pixels[i];
        rgba[o + 1] = pixels[i + 1];
        rgba[o + 2] = pixels[i + 2];
        rgba[o + 3] = 255;
      }
    } else {
      for (let i = 0, o = 0; i < pixels.length; i += 1, o += 4) {
        const g = pixels[i];
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      }
    }

    try {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const img = new ImageData(rgba, width, height);
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL('image/png');
      }

      const importCanvas = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
      const mod = await importCanvas('@napi-rs/canvas');
      const createCanvas = (mod as unknown as { createCanvas?: (w: number, h: number) => unknown }).createCanvas;
      const ImageDataCtor = (mod as unknown as { ImageData?: new (data: Uint8ClampedArray, w: number, h: number) => unknown }).ImageData;
      if (!createCanvas || !ImageDataCtor) return null;
      const canvas = createCanvas(width, height) as unknown as {
        getContext: (type: '2d') => { putImageData: (data: unknown, x: number, y: number) => void } | null;
        toDataURL?: (type?: string) => string;
      };
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const img = new ImageDataCtor(rgba, width, height);
      ctx.putImageData(img, 0, 0);
      if (typeof canvas.toDataURL === 'function') {
        return canvas.toDataURL('image/png');
      }
      return null;
    } catch {
      return null;
    }
  }

  private async extractImagesFallbackUnpdf(pageNumber0: number): Promise<PDFImageContent[]> {
    const unpdf = await this.getUnpdf();
    if (!this.document || typeof unpdf.extractImages !== 'function') return [];
    await this.ensureOfficialPdfjs();

    const extracted = await unpdf.extractImages(this.document as unknown, pageNumber0 + 1);
    const images: PDFImageContent[] = [];
    for (const img of extracted) {
      const dataUrl = await this.pixelsToPngDataUrl(img.data, img.width, img.height, img.channels);
      if (!dataUrl) continue;
      images.push({
        data: dataUrl,
        format: 'png',
        x: 0,
        y: 0,
        width: img.width,
        height: img.height
      });
    }
    return images;
  }

  private async extractGraphics(pdfPage: PDFJSPage, pageHeight: number): Promise<PDFGraphicsContent[]> {
    const pdfjs = await this.getPdfjs();
    const OPS = pdfjs.OPS;
    if (!OPS || typeof pdfPage.getOperatorList !== 'function') {
      return [];
    }

    const opList = await pdfPage.getOperatorList();
    const { fnArray, argsArray } = opList as { fnArray: number[]; argsArray: unknown[] };

    const multiply = (m1: number[], m2: number[]): number[] => {
      const [a1, b1, c1, d1, e1, f1] = m1;
      const [a2, b2, c2, d2, e2, f2] = m2;
      return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1
      ];
    };

    const graphics: PDFGraphicsContent[] = [];
    let currentPath: string[] = [];
    const state: {
      ctm: number[];
      stack: number[][];
      stroke?: string;
      fill?: string;
      strokeWidth?: number;
      strokeOpacity?: number;
      fillOpacity?: number;
      lineCap?: 'butt' | 'round' | 'square';
      lineJoin?: 'miter' | 'round' | 'bevel';
    } = {
      ctm: [1, 0, 0, 1, 0, 0],
      stack: []
    };

    const transformPoint = (x: number, y: number, m: number[]): { x: number; y: number } => {
      const [a, b, c, d, e, f] = m;
      const tx = a * x + c * y + e;
      const ty = b * x + d * y + f;
      return { x: tx, y: pageHeight - ty };
    };

    const pushPathGraphic = (fill: boolean, stroke: boolean): void => {
      if (currentPath.length === 0) return;
      const pathString = currentPath.join(' ');
      graphics.push({
        type: 'path',
        path: pathString,
        stroke: stroke ? state.stroke || '#000000' : undefined,
        strokeWidth: stroke ? state.strokeWidth || 1 : undefined,
        strokeOpacity: stroke ? state.strokeOpacity : undefined,
        fill: fill ? state.fill || '#000000' : undefined,
        fillOpacity: fill ? state.fillOpacity : undefined,
        lineCap: state.lineCap,
        lineJoin: state.lineJoin
      });
      currentPath = [];
    };

    const rgbToHex = (r: number, g: number, b: number): string => {
      const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
      return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i] as unknown[];

      switch (fn) {
        case OPS.save:
          state.stack.push([...state.ctm]);
          break;
        case OPS.restore:
          state.ctm = state.stack.pop() || [1, 0, 0, 1, 0, 0];
          break;
        case OPS.transform: {
          const [a, b, c, d, e, f] = (args || []) as number[];
          if ([a, b, c, d, e, f].every((n) => typeof n === 'number')) {
            state.ctm = multiply(state.ctm, [a, b, c, d, e, f]);
          }
          break;
        }
        case OPS.moveTo: {
          const [x, y] = (args || []) as number[];
          if (typeof x === 'number' && typeof y === 'number') {
            const pt = transformPoint(x, y, state.ctm);
            currentPath.push(`M ${pt.x} ${pt.y}`);
          }
          break;
        }
        case OPS.lineTo: {
          const [x, y] = (args || []) as number[];
          if (typeof x === 'number' && typeof y === 'number') {
            const pt = transformPoint(x, y, state.ctm);
            currentPath.push(`L ${pt.x} ${pt.y}`);
          }
          break;
        }
        case OPS.curveTo: {
          const [x1, y1, x2, y2, x3, y3] = (args || []) as number[];
          if ([x1, y1, x2, y2, x3, y3].every((n) => typeof n === 'number')) {
            const p1 = transformPoint(x1, y1, state.ctm);
            const p2 = transformPoint(x2, y2, state.ctm);
            const p3 = transformPoint(x3, y3, state.ctm);
            currentPath.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`);
          }
          break;
        }
        case OPS.closePath:
          currentPath.push('Z');
          break;
        case OPS.rectangle: {
          const [xRaw, yRaw, wRaw, hRaw] = (args || []) as number[];
          if ([xRaw, yRaw, wRaw, hRaw].every((n) => typeof n === 'number')) {
            const { x, y } = transformPoint(xRaw, yRaw, state.ctm);
            const { x: x2, y: y2 } = transformPoint(xRaw + wRaw, yRaw + hRaw, state.ctm);
            const width = x2 - x;
            const height = y2 - y;
            currentPath.push(`M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`);
          }
          break;
        }
        case OPS.setLineWidth: {
          const [w] = (args || []) as number[];
          if (typeof w === 'number') state.strokeWidth = w;
          break;
        }
        case OPS.setStrokeRGBColor: {
          const [r, g, b] = (args || []) as number[];
          if ([r, g, b].every((n) => typeof n === 'number')) state.stroke = rgbToHex(r, g, b);
          break;
        }
        case OPS.setFillRGBColor: {
          const [r, g, b] = (args || []) as number[];
          if ([r, g, b].every((n) => typeof n === 'number')) state.fill = rgbToHex(r, g, b);
          break;
        }
        case OPS.setStrokeAlpha: {
          const [a] = (args || []) as number[];
          if (typeof a === 'number') state.strokeOpacity = a;
          break;
        }
        case OPS.setFillAlpha: {
          const [a] = (args || []) as number[];
          if (typeof a === 'number') state.fillOpacity = a;
          break;
        }
        case OPS.setLineCap: {
          const [cap] = (args || []) as number[];
          const caps: Array<'butt' | 'round' | 'square'> = ['butt', 'round', 'square'];
          if (typeof cap === 'number' && caps[cap]) state.lineCap = caps[cap];
          break;
        }
        case OPS.setLineJoin: {
          const [join] = (args || []) as number[];
          const joins: Array<'miter' | 'round' | 'bevel'> = ['miter', 'round', 'bevel'];
          if (typeof join === 'number' && joins[join]) state.lineJoin = joins[join];
          break;
        }
        case OPS.stroke:
          pushPathGraphic(false, true);
          break;
        case OPS.fill:
        case OPS.eoFill:
          pushPathGraphic(true, false);
          break;
        case OPS.fillStroke:
        case OPS.eoFillStroke:
          pushPathGraphic(true, true);
          break;
        default:
          break;
      }
    }

    return graphics;
  }

  async parsePage(pageNumber: number, options: PDFParserOptions): Promise<PDFPage> {
    if (!this.document) {
      throw new Error('Document not loaded');
    }

    const pdfPage = await this.document.getPage(pageNumber + 1);
    const viewport = pdfPage.getViewport({ scale: 1.0 });

    const page: PDFPage = {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      content: {
        text: [],
        images: [],
        graphics: [],
        forms: [],
        annotations: []
      }
    };

    if (options.extractText) {
      const textResult = await this.textExtractor.extractText(pdfPage);
      page.content.text = textResult.text;
    }

    if (options.extractImages) {
      page.content.images = await this.extractImagesFallbackUnpdf(pageNumber);
      if (page.content.images.length === 0) {
        try {
          const imageResult = await this.imageExtractor.extractImages(
            pdfPage as unknown as Parameters<PDFJSImageExtractor['extractImages']>[0]
          );
          page.content.images = imageResult.images;
        } catch {
          // ignore
        }
      }
    }

    if (options.extractGraphics && typeof pdfPage.getOperatorList === 'function') {
      try {
        page.content.graphics = await this.extractGraphics(pdfPage, viewport.height);
      } catch (error) {
        console.debug('Failed to extract graphics:', error);
      }
    }

    if (options.extractAnnotations && typeof pdfPage.getAnnotations === 'function') {
      try {
        const annotations = await pdfPage.getAnnotations();
        page.content.annotations = annotations
          .map((ann) => this.mapAnnotation(ann, viewport.height))
          .filter((a): a is NonNullable<typeof a> => Boolean(a));
      } catch (error) {
        console.debug('Failed to extract annotations:', error);
      }
    }

    if (options.extractForms && typeof pdfPage.getAnnotations === 'function') {
      try {
        const annotations = await pdfPage.getAnnotations();
        const forms = annotations
          .map((ann) => this.mapForm(ann, viewport.height))
          .filter((f): f is NonNullable<typeof f> => Boolean(f));
        page.content.forms = forms;
      } catch (error) {
        console.debug('Failed to extract form fields:', error);
      }
    }

    return page;
  }

  private mapAnnotation(annotation: PDFJSAnnotation, pageHeight: number) {
    if (!annotation.rect || annotation.rect.length < 4) {
      return null;
    }
    const [x1, y1, x2, y2] = annotation.rect;
    const x = x1;
    const yTop = pageHeight - y2;
    const width = x2 - x1;
    const height = y2 - y1;

    const subtype = (annotation.subtype || '').toLowerCase();
    let type: 'link' | 'note' | 'highlight' | 'underline' | 'strikeout' = 'note';
    if (subtype === 'link') type = 'link';
    else if (subtype === 'highlight') type = 'highlight';
    else if (subtype === 'underline') type = 'underline';
    else if (subtype === 'strikeout') type = 'strikeout';

    return {
      type,
      x,
      y: yTop,
      width,
      height,
      content: annotation.contents,
      url: annotation.url
    };
  }

  private mapForm(annotation: PDFJSAnnotation, pageHeight: number) {
    if (annotation.subtype?.toLowerCase() !== 'widget') {
      return null;
    }
    if (!annotation.rect || annotation.rect.length < 4) {
      return null;
    }
    const [x1, y1, x2, y2] = annotation.rect;
    const x = x1;
    const yTop = pageHeight - y2;
    const width = x2 - x1;
    const height = y2 - y1;

    const fieldType = annotation.fieldType?.toLowerCase();
    let type: 'text' | 'checkbox' | 'radio' | 'button' | 'dropdown' | null = null;
    if (fieldType === 'tx') type = 'text';
    else if (fieldType === 'btn') {
      type = typeof annotation.value === 'boolean' ? 'checkbox' : 'button';
    } else if (fieldType === 'ch') type = 'dropdown';

    if (!type) return null;

    return {
      type,
      name: annotation.fieldName || '',
      value: annotation.value ?? '',
      x,
      y: yTop,
      width,
      height
    };
  }

  async parseDocument(
    data: ArrayBuffer,
    options: PDFParserOptions
  ): Promise<PDFDocument> {
    await this.loadDocument(data);

    const pageCount = await this.getPageCount();
    const metadata = await this.getMetadata();
    const pages: PDFPage[] = [];

    for (let i = 0; i < pageCount; i++) {
      const page = await this.parsePage(i, options);
      pages.push(page);
    }

    return {
      pageCount,
      metadata,
      pages
    };
  }

  dispose(): void {
    this.document = null;
    this.pdfjsLib = null;
  }
}
