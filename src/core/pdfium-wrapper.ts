import type {
  PDFDocument,
  PDFPage,
  PDFParserOptions,
  PDFMetadata,
  PDFAnnotation,
  PDFFormContent
} from '../types/pdf.js';
import { PDFiumTextExtractor } from './pdfium-text-extractor.js';
import { PDFiumImageExtractor } from './pdfium-image-extractor.js';

type PDFiumLibrary = {
  loadDocument: (data: ArrayBuffer) => Promise<PDFiumDocument>;
};

type PDFiumDocument = {
  getPageCount: () => number;
  loadPage: (pageNumber: number) => Promise<PDFiumPage>;
  getMetadata: () => Promise<PDFMetadata>;
};

type PDFiumPage = {
  getWidth: () => number;
  getHeight: () => number;
  getTextWithPosition: () => Promise<PDFiumTextItem[]>;
  getImages?: () => Promise<PDFiumImage[]>;
  getText: () => Promise<string>;
  render: (options?: { scale?: number }) => Promise<ImageData>;
  // Optional APIs; not all bindings expose these
  getAnnotations?: () => Promise<Array<{
    subtype?: string;
    rect?: number[];
    url?: string;
    contents?: string;
  }>>;
  getForms?: () => Promise<Array<{
    type?: string;
    name?: string;
    value?: string | boolean;
    rect?: number[];
  }>>;
};

type PDFiumTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
};

type PDFiumImage = {
  data: ArrayBuffer;
  format: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export class PDFiumWrapper {
  private pdfium: PDFiumLibrary | null = null;
  private document: PDFiumDocument | null = null;
  private textExtractor: PDFiumTextExtractor;
  private imageExtractor: PDFiumImageExtractor;

  constructor() {
    this.textExtractor = new PDFiumTextExtractor();
    this.imageExtractor = new PDFiumImageExtractor();
  }

  async initialize(): Promise<void> {
    try {
      // Try to import @hyzyla/pdfium
      const pdfiumModule = await import('@hyzyla/pdfium').catch(() => null);
      
      if (pdfiumModule && pdfiumModule.PDFiumLibrary) {
        // @hyzyla/pdfium API
        // @ts-expect-error @hyzyla/pdfium is not typed
        this.pdfium = await pdfiumModule.PDFiumLibrary.create() as PDFiumLibrary;
      } else {
        throw new Error('PDFium library not available. Please install @hyzyla/pdfium');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize PDFium: ${errorMessage}`);
    }
  }

  async loadDocument(data: ArrayBuffer): Promise<void> {
    if (!this.pdfium) {
      await this.initialize();
    }

    if (!this.pdfium) {
      throw new Error('PDFium not initialized');
    }

    try {
      this.document = await this.pdfium.loadDocument(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load PDF document: ${errorMessage}`);
    }
  }

  async getPageCount(): Promise<number> {
    if (!this.document) {
      throw new Error('Document not loaded');
    }

    return this.document.getPageCount();
  }

  async getMetadata(): Promise<PDFMetadata> {
    if (!this.document) {
      throw new Error('Document not loaded');
    }

    try {
      return await this.document.getMetadata();
    } catch (error) {
      console.warn('Failed to extract metadata:', error);
      return {};
    }
  }

  async parsePage(
    pageNumber: number,
    options: PDFParserOptions
  ): Promise<PDFPage> {
    if (!this.document) {
      throw new Error('Document not loaded');
    }

    const pdfPage = await this.document.loadPage(pageNumber);
    const width = pdfPage.getWidth();
    const height = pdfPage.getHeight();

    const page: PDFPage = {
      pageNumber,
      width,
      height,
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
      const imageResult = await this.imageExtractor.extractImages(pdfPage);
      page.content.images = imageResult.images;
    }

    if (options.extractGraphics) {
      // PDFium does not expose vector drawing ops in this wrapper; use raster fallback
      try {
        const renderScale = 1.0;
        const imageData = await pdfPage.render({ scale: renderScale });
        const dataUrl = this.convertImageDataToBase64(imageData);
        // Avoid duplicating a full-page raster if images were already extracted
        const shouldAddRaster = !options.extractImages || page.content.images.length === 0;
        if (shouldAddRaster) {
          page.content.graphics.push({
            type: 'raster',
            data: dataUrl,
            x: 0,
            y: 0,
            width,
            height
          });
        }
      } catch (error) {
        console.debug('PDFium graphics raster fallback failed:', error);
      }
    }

    if (options.extractAnnotations && typeof pdfPage.getAnnotations === 'function') {
      try {
        const anns = await pdfPage.getAnnotations();
        page.content.annotations = anns
          .map((ann) => {
            if (!ann.rect || ann.rect.length < 4) return null;
            const [x1, y1, x2, y2] = ann.rect;
            const x = x1;
            const y = height - y2;
            const width = x2 - x1;
            const heightRect = y2 - y1;
            return {
              type: (ann.subtype || 'note').toLowerCase() as PDFAnnotation['type'],
              x,
              y,
              width,
              height: heightRect,
              url: ann.url,
              content: ann.contents
            };
          })
          .filter((v): v is NonNullable<typeof v> => Boolean(v));
      } catch (error) {
        console.debug('PDFium annotations not available:', error);
      }
    }

    if (options.extractForms && typeof pdfPage.getForms === 'function') {
      try {
        const forms = await pdfPage.getForms();
        page.content.forms = forms
          .map((f) => {
            if (!f.rect || f.rect.length < 4) return null;
            const [x1, y1, x2, y2] = f.rect;
            const x = x1;
            const y = height - y2;
            const width = x2 - x1;
            const heightRect = y2 - y1;
            const type = (f.type || '').toLowerCase();
            const formType = type === 'text' || type === 'button' || type === 'checkbox' || type === 'radio' || type === 'dropdown'
              ? (type as PDFFormContent['type'])
              : 'text';
            return {
              type: formType,
              name: f.name || '',
              value: f.value ?? '',
              x,
              y,
              width,
              height: heightRect
            };
          })
          .filter((v): v is NonNullable<typeof v> => Boolean(v));
      } catch (error) {
        console.debug('PDFium forms not available:', error);
      }
    }

    return page;
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
    // TODO: Clean up PDFium resources
    this.document = null;
  }

  private convertImageDataToBase64(imageData: ImageData): string {
    // Browser: canvas path
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
      }
    }

    // Node.js fallback: simple RGBA to base64 (not PNG encoded, but usable as data URI for our purposes)
    const data = imageData.data;
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64 = typeof Buffer !== 'undefined' ? Buffer.from(binary, 'binary').toString('base64') : btoa(binary);
    return `data:image/png;base64,${base64}`;
  }
}
