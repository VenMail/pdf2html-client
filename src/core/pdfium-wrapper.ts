import type {
  PDFDocument,
  PDFPage,
  PDFParserOptions,
  PDFMetadata,
  PDFGraphicsContent
} from '../types/pdf.js';

type PdfiumInitOptions = {
  wasmUrl?: string;
  wasmBinary?: ArrayBuffer;
};

type WrappedPdfiumModule = {
  PDFiumExt_Init: () => void;

  pdfium: {
    HEAPU8: Uint8Array;
    UTF16ToString: (ptr: number) => string;
    wasmExports: {
      malloc: (size: number) => number;
      free: (ptr: number) => void;
    };
  };

  FPDF_GetLastError: () => number;
  FPDF_LoadMemDocument: (dataPtr: number, size: number, password: number) => number;
  FPDF_CloseDocument: (docPtr: number) => void;
  FPDF_GetPageCount: (docPtr: number) => number;
  FPDF_LoadPage: (docPtr: number, pageIndex: number) => number;
  FPDF_ClosePage: (pagePtr: number) => void;
  FPDF_GetPageWidthF: (pagePtr: number) => number;
  FPDF_GetPageHeightF: (pagePtr: number) => number;

  FPDFText_LoadPage: (pagePtr: number) => number;
  FPDFText_ClosePage: (textPagePtr: number) => void;
  FPDFText_CountChars: (textPagePtr: number) => number;
  FPDFText_GetUnicode: (textPagePtr: number, index: number) => number;
  FPDFText_GetCharBox: (
    textPagePtr: number,
    index: number,
    leftPtr: number,
    rightPtr: number,
    bottomPtr: number,
    topPtr: number
  ) => number;
  FPDFText_GetFontSize: (textPagePtr: number, index: number) => number;
  FPDFText_GetFillColor: (
    textPagePtr: number,
    index: number,
    rPtr: number,
    gPtr: number,
    bPtr: number,
    aPtr: number
  ) => number;
  FPDFText_GetCharAngle: (textPagePtr: number, index: number) => number;
  FPDFText_GetFontWeight: (textPagePtr: number, index: number) => number;
  FPDFText_GetFontInfo: (textPagePtr: number, index: number, bufferPtr: number, buflen: number, flagsPtr: number) => number;

  FPDFPage_CountObjects: (pagePtr: number) => number;
  FPDFPage_GetObject: (pagePtr: number, index: number) => number;
  FPDFPageObj_GetType: (pageObjPtr: number) => number;
  FPDFPageObj_GetBounds: (pageObjPtr: number, leftPtr: number, bottomPtr: number, rightPtr: number, topPtr: number) => number;
  FPDFPageObj_GetMatrix?: (pageObjPtr: number, matrixPtr: number) => number;

  FPDFPageObj_GetStrokeColor?: (pageObjPtr: number, rPtr: number, gPtr: number, bPtr: number, aPtr: number) => number;
  FPDFPageObj_GetFillColor?: (pageObjPtr: number, rPtr: number, gPtr: number, bPtr: number, aPtr: number) => number;
  FPDFPageObj_GetStrokeWidth?: (pageObjPtr: number, widthPtr: number) => number;
  FPDFPageObj_GetLineCap?: (pageObjPtr: number) => number;
  FPDFPageObj_GetLineJoin?: (pageObjPtr: number) => number;

  FPDFPath_CountSegments?: (pathObjPtr: number) => number;
  FPDFPath_GetPathSegment?: (pathObjPtr: number, index: number) => number;
  FPDFPathSegment_GetPoint?: (pathSegPtr: number, xPtr: number, yPtr: number) => number;
  FPDFPathSegment_GetType?: (pathSegPtr: number) => number;
  FPDFPathSegment_GetClose?: (pathSegPtr: number) => number;
  FPDFPath_GetDrawMode?: (pathObjPtr: number, fillmodePtr: number, strokePtr: number) => number;

  FPDFImageObj_GetRenderedBitmap: (docPtr: number, pagePtr: number, imageObjPtr: number) => number;
  FPDFImageObj_GetBitmap: (imageObjPtr: number) => number;

  FPDFImageObj_GetImageDataDecoded?: (imageObjPtr: number, bufferPtr: number, buflen: number) => number;
  FPDFImageObj_GetImageDataRaw?: (imageObjPtr: number, bufferPtr: number, buflen: number) => number;
  FPDFImageObj_GetImageFilterCount?: (imageObjPtr: number) => number;
  FPDFImageObj_GetImageFilter?: (imageObjPtr: number, index: number, bufferPtr: number, buflen: number) => number;
  FPDFImageObj_GetImageMetadata?: (imageObjPtr: number, pagePtr: number, metadataPtr: number) => number;

  FPDFBitmap_GetBuffer: (bitmapPtr: number) => number;
  FPDFBitmap_GetWidth: (bitmapPtr: number) => number;
  FPDFBitmap_GetHeight: (bitmapPtr: number) => number;
  FPDFBitmap_GetStride: (bitmapPtr: number) => number;
  FPDFBitmap_GetFormat?: (bitmapPtr: number) => number;
  FPDFBitmap_Destroy: (bitmapPtr: number) => void;
};

type LoadedEmbedPdfiumDocument = {
  docPtr: number;
  filePtr: number;
  fileLen: number;
};

let cachedPdfiumModule: WrappedPdfiumModule | null = null;
let cachedPdfiumInitPromise: Promise<WrappedPdfiumModule> | null = null;
let cachedWasmBinary: ArrayBuffer | null = null;
let cachedWasmSourceKey: string | null = null;

const isValidWasmBinary = (buf: ArrayBuffer): boolean => {
  if (buf.byteLength < 4) return false;
  const u8 = new Uint8Array(buf, 0, 4);
  return u8[0] === 0x00 && u8[1] === 0x61 && u8[2] === 0x73 && u8[3] === 0x6d;
};

const getGlobalPdfiumInitOptions = (): PdfiumInitOptions => {
  if (typeof window === 'undefined') return {};
  const w = window as unknown as {
    __PDFIUM_WASM_URL__?: string;
    __PDFIUM_WASM_BINARY__?: ArrayBuffer;
  };
  return {
    wasmUrl: typeof w.__PDFIUM_WASM_URL__ === 'string' ? w.__PDFIUM_WASM_URL__ : undefined,
    wasmBinary: w.__PDFIUM_WASM_BINARY__ instanceof ArrayBuffer ? w.__PDFIUM_WASM_BINARY__ : undefined
  };
};

export class PDFiumWrapper {
  private pdfium: WrappedPdfiumModule | null = null;
  private document: LoadedEmbedPdfiumDocument | null = null;
  private enableFullPageRasterFallback: boolean = false;

  constructor() {
  }

  async initialize(options: PdfiumInitOptions = {}): Promise<void> {
    try {
      if (this.pdfium) return;
      if (typeof window === 'undefined') {
        throw new Error('PDFium (EmbedPDF) is only supported in the browser in this project');
      }

      if (cachedPdfiumModule) {
        this.pdfium = cachedPdfiumModule;
        return;
      }

      const mergedOptions = { ...getGlobalPdfiumInitOptions(), ...options };
      const wasmSourceKey = mergedOptions.wasmBinary ? 'binary' : mergedOptions.wasmUrl ? mergedOptions.wasmUrl : 'default';

      if (cachedPdfiumInitPromise && cachedWasmSourceKey === wasmSourceKey) {
        this.pdfium = await cachedPdfiumInitPromise;
        return;
      }

      const mod = (await import('@embedpdf/pdfium')) as unknown as {
        init?: (options?: { wasmBinary?: ArrayBuffer }) => Promise<unknown>;
        DEFAULT_PDFIUM_WASM_URL?: string;
      };
      if (typeof mod.init !== 'function') {
        throw new Error('PDFium library not available. Please install @embedpdf/pdfium');
      }

      cachedWasmSourceKey = wasmSourceKey;
      cachedPdfiumInitPromise = (async (): Promise<WrappedPdfiumModule> => {
        let wasmBinary = mergedOptions.wasmBinary;
        if (!wasmBinary) {
          const wasmUrl =
            mergedOptions.wasmUrl ||
            (typeof mod.DEFAULT_PDFIUM_WASM_URL === 'string'
              ? mod.DEFAULT_PDFIUM_WASM_URL
              : 'https://cdn.jsdelivr.net/npm/@embedpdf/pdfium/dist/pdfium.wasm');

          if (cachedWasmBinary && cachedWasmSourceKey === wasmUrl && isValidWasmBinary(cachedWasmBinary)) {
            wasmBinary = cachedWasmBinary;
          } else {
            const response = await fetch(wasmUrl);
            const fetched = await response.arrayBuffer();
            if (!isValidWasmBinary(fetched)) {
              throw new Error(`Invalid PDFium wasm binary fetched from ${wasmUrl}`);
            }
            wasmBinary = fetched;
            cachedWasmBinary = fetched;
            cachedWasmSourceKey = wasmUrl;
          }
        }

        if (!wasmBinary || !isValidWasmBinary(wasmBinary)) {
          throw new Error('Invalid PDFium wasm binary');
        }

        const instance = (await mod.init!({ wasmBinary })) as WrappedPdfiumModule;
        instance.PDFiumExt_Init();
        cachedPdfiumModule = instance;
        return instance;
      })();

      this.pdfium = await cachedPdfiumInitPromise;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize PDFium: ${errorMessage}`);
    }
  }

  async loadDocument(data: ArrayBuffer): Promise<void> {
    if (!this.pdfium) {
      await this.initialize();
    }

    try {
      if (!this.pdfium) {
        throw new Error('PDFium not initialized');
      }

      if (this.document) {
        try {
          this.pdfium.FPDF_CloseDocument(this.document.docPtr);
        } catch {
          // ignore
        }
        try {
          this.pdfium.pdfium.wasmExports.free(this.document.filePtr);
        } catch {
          // ignore
        }
        this.document = null;
      }

      const bytes = new Uint8Array(data);
      const filePtr = this.pdfium.pdfium.wasmExports.malloc(bytes.length);
      this.pdfium.pdfium.HEAPU8.set(bytes, filePtr);

      const docPtr = this.pdfium.FPDF_LoadMemDocument(filePtr, bytes.length, 0);
      if (!docPtr) {
        const err = this.pdfium.FPDF_GetLastError();
        this.pdfium.pdfium.wasmExports.free(filePtr);
        throw new Error(`Failed to load PDF document: ${err}`);
      }

      this.document = { docPtr, filePtr, fileLen: bytes.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load PDF document: ${errorMessage}`);
    }
  }

  async getPageCount(): Promise<number> {
    if (!this.document || !this.pdfium) {
      throw new Error('Document not loaded');
    }
    return this.pdfium.FPDF_GetPageCount(this.document.docPtr);
  }

  async getMetadata(): Promise<PDFMetadata> {
    try {
      return {};
    } catch (error) {
      console.warn('Failed to extract metadata:', error);
      return {};
    }
  }

  private allocDouble(): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    return this.pdfium.pdfium.wasmExports.malloc(8);
  }

  private allocFloat32(): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    return this.pdfium.pdfium.wasmExports.malloc(4);
  }

  private allocInt(): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    return this.pdfium.pdfium.wasmExports.malloc(4);
  }

  private readFloat64(ptr: number): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    const view = new DataView(
      this.pdfium.pdfium.HEAPU8.buffer,
      this.pdfium.pdfium.HEAPU8.byteOffset + ptr,
      8
    );
    return view.getFloat64(0, true);
  }

  private readFloat32(ptr: number): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    const view = new DataView(
      this.pdfium.pdfium.HEAPU8.buffer,
      this.pdfium.pdfium.HEAPU8.byteOffset + ptr,
      4
    );
    return view.getFloat32(0, true);
  }

  private readInt32(ptr: number): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    const view = new DataView(
      this.pdfium.pdfium.HEAPU8.buffer,
      this.pdfium.pdfium.HEAPU8.byteOffset + ptr,
      4
    );
    return view.getInt32(0, true);
  }

  private readUInt32(ptr: number): number {
    if (!this.pdfium) throw new Error('PDFium not initialized');
    const view = new DataView(
      this.pdfium.pdfium.HEAPU8.buffer,
      this.pdfium.pdfium.HEAPU8.byteOffset + ptr,
      4
    );
    return view.getUint32(0, true);
  }

  private rgbaToDataUrl(rgba: Uint8Array, width: number, height: number): string {
    if (typeof document === 'undefined') {
      throw new Error('Rendering requires a browser environment');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create canvas 2D context');
    const clamped = new Uint8ClampedArray(rgba);
    const img = new ImageData(clamped, width, height);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  private rgbToHex(r: number, g: number, b: number): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return `#${[clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  private mapLineCap(cap: number): PDFGraphicsContent['lineCap'] {
    if (cap === 1) return 'round';
    if (cap === 2) return 'square';
    return 'butt';
  }

  private mapLineJoin(join: number): PDFGraphicsContent['lineJoin'] {
    if (join === 1) return 'round';
    if (join === 2) return 'bevel';
    return 'miter';
  }

  private bitmapToRgbaPacked(
    bitmapBuffer: Uint8Array,
    width: number,
    height: number,
    stride: number,
    format: number
  ): Uint8Array {
    const out = new Uint8Array(width * height * 4);

    // PDFium formats (as per fpdfview.h):
    // 1 = Gray, 2 = BGR, 3 = BGRx, 4 = BGRA
    // Treat unknown as BGRA.
    const fmt = format || 4;

    for (let y = 0; y < height; y++) {
      const rowIn = y * stride;
      const rowOut = y * width * 4;

      for (let x = 0; x < width; x++) {
        const o = rowOut + x * 4;

        if (fmt === 1) {
          const i = rowIn + x;
          const g = bitmapBuffer[i] ?? 0;
          out[o] = g;
          out[o + 1] = g;
          out[o + 2] = g;
          out[o + 3] = 255;
          continue;
        }

        if (fmt === 2) {
          const i = rowIn + x * 3;
          const b = bitmapBuffer[i] ?? 0;
          const g = bitmapBuffer[i + 1] ?? 0;
          const r = bitmapBuffer[i + 2] ?? 0;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
          out[o + 3] = 255;
          continue;
        }

        if (fmt === 3) {
          const i = rowIn + x * 4;
          const b = bitmapBuffer[i] ?? 0;
          const g = bitmapBuffer[i + 1] ?? 0;
          const r = bitmapBuffer[i + 2] ?? 0;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
          out[o + 3] = 255;
          continue;
        }

        // BGRA
        const i = rowIn + x * 4;
        const b = bitmapBuffer[i] ?? 0;
        const g = bitmapBuffer[i + 1] ?? 0;
        const r = bitmapBuffer[i + 2] ?? 0;
        const a = bitmapBuffer[i + 3] ?? 255;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    }

    return out;
  }

  async parsePage(
    pageNumber: number,
    options: PDFParserOptions
  ): Promise<PDFPage> {
    if (!this.document || !this.pdfium) {
      throw new Error('Document not loaded');
    }

    const pagePtr = this.pdfium.FPDF_LoadPage(this.document.docPtr, pageNumber);
    if (!pagePtr) {
      throw new Error(`Failed to load page ${pageNumber}`);
    }

    try {
      const width = this.pdfium.FPDF_GetPageWidthF(pagePtr);
      const height = this.pdfium.FPDF_GetPageHeightF(pagePtr);

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
        try {
          const textPagePtr = this.pdfium.FPDFText_LoadPage(pagePtr);
          if (textPagePtr) {
            try {
              const charCount = this.pdfium.FPDFText_CountChars(textPagePtr);

              const leftPtr = this.allocDouble();
              const rightPtr = this.allocDouble();
              const bottomPtr = this.allocDouble();
              const topPtr = this.allocDouble();
              const rPtr = this.allocInt();
              const gPtr = this.allocInt();
              const bPtr = this.allocInt();
              const aPtr = this.allocInt();
              const flagsPtr = this.allocInt();
              const fontBufPtr = this.pdfium.pdfium.wasmExports.malloc(512);

              try {
                let current: PDFPage['content']['text'][number] | null = null;
                const pushCurrent = (): void => {
                  if (current) page.content.text.push(current);
                  current = null;
                };

                const toCssColor = (rr: number, gg: number, bb: number, aa: number): string => {
                  const a = Math.max(0, Math.min(255, aa)) / 255;
                  return `rgba(${rr}, ${gg}, ${bb}, ${a})`;
                };

                const decoder = new TextDecoder('utf-8');

                for (let i = 0; i < charCount; i++) {
                  const codePoint = this.pdfium.FPDFText_GetUnicode(textPagePtr, i);
                  if (!codePoint) continue;
                  const ch = String.fromCodePoint(codePoint);

                  const okBox = this.pdfium.FPDFText_GetCharBox(
                    textPagePtr,
                    i,
                    leftPtr,
                    rightPtr,
                    bottomPtr,
                    topPtr
                  );
                  if (!okBox) continue;
                  const left = this.readFloat64(leftPtr);
                  const right = this.readFloat64(rightPtr);
                  const bottom = this.readFloat64(bottomPtr);
                  const top = this.readFloat64(topPtr);
                  const x = left;
                  const y = bottom;
                  const w = Math.max(0, right - left);
                  const h = Math.max(0, top - bottom);

                  const fontSize = this.pdfium.FPDFText_GetFontSize(textPagePtr, i);
                  const okColor = this.pdfium.FPDFText_GetFillColor(textPagePtr, i, rPtr, gPtr, bPtr, aPtr);
                  const rr = okColor ? this.readUInt32(rPtr) : 0;
                  const gg = okColor ? this.readUInt32(gPtr) : 0;
                  const bb = okColor ? this.readUInt32(bPtr) : 0;
                  const aa = okColor ? this.readUInt32(aPtr) : 255;

                  const fontLen = this.pdfium.FPDFText_GetFontInfo(textPagePtr, i, fontBufPtr, 512, flagsPtr);
                  const fontName = fontLen > 0
                    ? decoder.decode(
                        new Uint8Array(
                          this.pdfium.pdfium.HEAPU8.buffer,
                          this.pdfium.pdfium.HEAPU8.byteOffset + fontBufPtr,
                          Math.min(fontLen, 512)
                        ).filter((v) => v !== 0)
                      )
                    : '';

                  const fontWeightRaw = this.pdfium.FPDFText_GetFontWeight(textPagePtr, i);
                  const fontWeight = fontWeightRaw > 0 ? fontWeightRaw : 400;
                  const angleRad = this.pdfium.FPDFText_GetCharAngle(textPagePtr, i);
                  const rotation = angleRad ? (angleRad * 180) / Math.PI : 0;

                  const styleKey = `${fontName}|${fontSize}|${rr}|${gg}|${bb}|${aa}|${fontWeight}|${rotation}`;

                  const isWhitespace = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
                  const effectiveFontFamily = fontName || 'Unknown';

                  if (!current) {
                    current = {
                      text: isWhitespace ? '' : ch,
                      x,
                      y,
                      width: w,
                      height: h,
                      fontSize,
                      fontFamily: effectiveFontFamily,
                      fontWeight,
                      fontStyle: 'normal',
                      color: toCssColor(rr, gg, bb, aa),
                      rotation: rotation || undefined
                    };
                    (current as unknown as { __styleKey?: string }).__styleKey = styleKey;
                    (current as unknown as { __pendingSpace?: boolean }).__pendingSpace = false;
                    (current as unknown as { __pendingSpaceXEnd?: number }).__pendingSpaceXEnd = undefined;
                    continue;
                  }

                  const prevKey = (current as unknown as { __styleKey?: string }).__styleKey;
                  const sameStyle = prevKey === styleKey;
                  const xEnd = current.x + current.width;
                  const gap = x - xEnd;
                  const adjacentTol = Math.max(0.6, Math.min(2.0, fontSize * 0.1));
                  const lineTol = Math.max(0.75, Math.min(2.5, Math.max(current.height, h) * 0.35));
                  const sameLine = Math.abs(y - current.y) <= lineTol;
                  const adjacent = Math.abs(gap) <= adjacentTol;
                  const spaceTol = Math.max(adjacentTol + 0.25, Math.min(fontSize * 0.95, adjacentTol + fontSize * 0.55));

                  if (sameStyle && sameLine) {
                    if (isWhitespace) {
                      if (gap >= -adjacentTol && gap <= spaceTol) {
                        const pending = current as unknown as { __pendingSpace?: boolean; __pendingSpaceXEnd?: number };
                        if (!pending.__pendingSpace) {
                          pending.__pendingSpace = true;
                          pending.__pendingSpaceXEnd = xEnd;
                        }
                        current.width = Math.max(current.width, (x + w) - current.x);
                        current.height = Math.max(current.height, h);
                        continue;
                      }
                    }

                    if (adjacent) {
                      const pending = current as unknown as { __pendingSpace?: boolean; __pendingSpaceXEnd?: number };
                      const currentTextLen = (current.text || '').replace(/\s+/g, '').length;
                      const avgCharW = currentTextLen > 0 ? current.width / currentTextLen : fontSize * 0.5;
                      const prevChar = (current.text || '').slice(-1);
                      const isPrevAlphaNum = /[A-Za-z0-9]/.test(prevChar);
                      const isNextAlphaNum = /[A-Za-z0-9]/.test(ch);
                      const caseBoundary = /[a-z]$/.test(prevChar) && /[A-Z]/.test(ch);
                      const caseBoundaryGap = Math.max(0.15, avgCharW * 0.08);
                      const boundaryGap = Math.max(adjacentTol + 0.1, avgCharW * 0.35);
                      const canSplit =
                        currentTextLen >= 2 &&
                        isPrevAlphaNum &&
                        isNextAlphaNum &&
                        (caseBoundary ? gap > caseBoundaryGap : gap > boundaryGap);

                      if (canSplit) {
                        if (pending.__pendingSpace) {
                          pending.__pendingSpace = false;
                          pending.__pendingSpaceXEnd = undefined;
                        }
                        pushCurrent();
                        current = {
                          text: ch,
                          x,
                          y,
                          width: w,
                          height: h,
                          fontSize,
                          fontFamily: effectiveFontFamily,
                          fontWeight,
                          fontStyle: 'normal',
                          color: toCssColor(rr, gg, bb, aa),
                          rotation: rotation || undefined
                        };
                        (current as unknown as { __styleKey?: string }).__styleKey = styleKey;
                        (current as unknown as { __pendingSpace?: boolean }).__pendingSpace = false;
                        (current as unknown as { __pendingSpaceXEnd?: number }).__pendingSpaceXEnd = undefined;
                        continue;
                      }

                      if (pending.__pendingSpace) {
                        const baseXEnd = typeof pending.__pendingSpaceXEnd === 'number' ? pending.__pendingSpaceXEnd : xEnd;
                        const effectiveGap = x - baseXEnd;
                        const spaceGap = Math.max(0.4, avgCharW * 0.28);
                        const prevAlpha = /[A-Za-z]/.test(prevChar);
                        const nextAlpha = /[A-Za-z]/.test(ch);
                        const inWordAlpha = prevAlpha && nextAlpha && !caseBoundary;
                        const minWordSpaceGap = Math.max(spaceGap, avgCharW * 0.75);
                        if (
                          effectiveGap > spaceGap &&
                          (!inWordAlpha || effectiveGap > minWordSpaceGap) &&
                          current.text.length > 0 &&
                          !current.text.endsWith(' ')
                        ) {
                          current.text += ' ';
                        }
                        pending.__pendingSpace = false;
                        pending.__pendingSpaceXEnd = undefined;
                      }

                      current.text += ch;
                      current.width = Math.max(current.width, (x + w) - current.x);
                      current.height = Math.max(current.height, h);
                      continue;
                    }

                    if (!isWhitespace && gap > adjacentTol && gap <= spaceTol) {
                      const pending = current as unknown as { __pendingSpace?: boolean; __pendingSpaceXEnd?: number };
                      const prevTrim = (current.text || '').trim();
                      const nextTrim = String(ch).trim();
                      const prevIsSingleLetter = /^[A-Za-z]$/.test(prevTrim);
                      const nextIsSingleLetter = /^[A-Za-z]$/.test(nextTrim);
                      const prevIsSingleDigit = /^[0-9]$/.test(prevTrim);
                      const nextIsSingleDigit = /^[0-9]$/.test(nextTrim);

                      const baseXEnd = typeof pending.__pendingSpaceXEnd === 'number' ? pending.__pendingSpaceXEnd : xEnd;
                      const effectiveGap = x - baseXEnd;
                      const high = Math.max(spaceTol + 0.25, fontSize * 0.55);
                      const wordGap = Math.max(fontSize * 0.3, adjacentTol + fontSize * 0.28);
                      const mustSpace = effectiveGap > high;
                      const likelyNoSpace =
                        (prevIsSingleLetter && nextIsSingleLetter) || (prevIsSingleDigit && nextIsSingleDigit);

                      const prevChar = prevTrim.slice(-1);
                      const caseBoundary = /[a-z]$/.test(prevChar) && /^[A-Z]/.test(nextTrim);
                      const inWordAlpha = /[A-Za-z]$/.test(prevTrim) && /^[A-Za-z]/.test(nextTrim) && !caseBoundary;
                      const insertSpace =
                        !likelyNoSpace &&
                        (mustSpace || (!inWordAlpha && effectiveGap > wordGap) || (caseBoundary && effectiveGap > 0));

                      pending.__pendingSpace = false;
                      pending.__pendingSpaceXEnd = undefined;

                      if (insertSpace && current.text.length > 0 && !current.text.endsWith(' ')) {
                        current.text += ' ';
                      }

                      pushCurrent();
                      current = {
                        text: ch,
                        x,
                        y,
                        width: w,
                        height: h,
                        fontSize,
                        fontFamily: effectiveFontFamily,
                        fontWeight,
                        fontStyle: 'normal',
                        color: toCssColor(rr, gg, bb, aa),
                        rotation: rotation || undefined
                      };
                      (current as unknown as { __styleKey?: string }).__styleKey = styleKey;
                      (current as unknown as { __pendingSpace?: boolean }).__pendingSpace = false;
                      (current as unknown as { __pendingSpaceXEnd?: number }).__pendingSpaceXEnd = undefined;
                      continue;
                    }
                  }

                  pushCurrent();
                  current = {
                    text: isWhitespace ? '' : ch,
                    x,
                    y,
                    width: w,
                    height: h,
                    fontSize,
                    fontFamily: effectiveFontFamily,
                    fontWeight,
                    fontStyle: 'normal',
                    color: toCssColor(rr, gg, bb, aa),
                    rotation: rotation || undefined
                  };
                  (current as unknown as { __styleKey?: string }).__styleKey = styleKey;
                  (current as unknown as { __pendingSpace?: boolean }).__pendingSpace = false;
                  (current as unknown as { __pendingSpaceXEnd?: number }).__pendingSpaceXEnd = undefined;
                }

                if (current) {
                  page.content.text.push(current);
                }

                page.content.text = page.content.text.filter((t) => {
                  if (!t.text || t.text.trim().length === 0) return false;
                  if (t.fontSize <= 1.25 && t.height <= 1.25) return false;
                  if (t.fontFamily === 'Unknown' && t.fontSize <= 2) return false;
                  return true;
                });
              } finally {
                this.pdfium.pdfium.wasmExports.free(fontBufPtr);
                this.pdfium.pdfium.wasmExports.free(flagsPtr);
                this.pdfium.pdfium.wasmExports.free(aPtr);
                this.pdfium.pdfium.wasmExports.free(bPtr);
                this.pdfium.pdfium.wasmExports.free(gPtr);
                this.pdfium.pdfium.wasmExports.free(rPtr);
                this.pdfium.pdfium.wasmExports.free(topPtr);
                this.pdfium.pdfium.wasmExports.free(bottomPtr);
                this.pdfium.pdfium.wasmExports.free(rightPtr);
                this.pdfium.pdfium.wasmExports.free(leftPtr);
              }
            } finally {
              this.pdfium.FPDFText_ClosePage(textPagePtr);
            }
          }
        } catch (error) {
          console.debug('PDFium text extraction failed:', error);
        }
      }

      if (options.extractGraphics) {
        try {
          if (
            typeof this.pdfium.FPDFPath_CountSegments === 'function' &&
            typeof this.pdfium.FPDFPath_GetPathSegment === 'function' &&
            typeof this.pdfium.FPDFPathSegment_GetPoint === 'function' &&
            typeof this.pdfium.FPDFPathSegment_GetType === 'function' &&
            typeof this.pdfium.FPDFPathSegment_GetClose === 'function'
          ) {
            const objCount = this.pdfium.FPDFPage_CountObjects(pagePtr);
            const xPtr = this.allocFloat32();
            const yPtr = this.allocFloat32();
            const leftPtr = this.allocFloat32();
            const bottomPtr = this.allocFloat32();
            const rightPtr = this.allocFloat32();
            const topPtr = this.allocFloat32();
            const fillModePtr = this.allocInt();
            const strokeFlagPtr = this.allocInt();
            const rPtr = this.allocInt();
            const gPtr = this.allocInt();
            const bPtr = this.allocInt();
            const aPtr = this.allocInt();
            const widthPtr = this.allocFloat32();

            try {
              for (let i = 0; i < objCount; i++) {
                const obj = this.pdfium.FPDFPage_GetObject(pagePtr, i);
                if (!obj) continue;

                const type = this.pdfium.FPDFPageObj_GetType(obj);
                if (type !== 2) continue;

                let matrix: [number, number, number, number, number, number] | null = null;
                if (typeof this.pdfium.FPDFPageObj_GetMatrix === 'function') {
                  const matrixPtr = this.pdfium.pdfium.wasmExports.malloc(24);
                  try {
                    const ok = this.pdfium.FPDFPageObj_GetMatrix(obj, matrixPtr);
                    if (ok) {
                      const dv = new DataView(
                        this.pdfium.pdfium.HEAPU8.buffer,
                        this.pdfium.pdfium.HEAPU8.byteOffset + matrixPtr,
                        24
                      );
                      matrix = [
                        dv.getFloat32(0, true),
                        dv.getFloat32(4, true),
                        dv.getFloat32(8, true),
                        dv.getFloat32(12, true),
                        dv.getFloat32(16, true),
                        dv.getFloat32(20, true)
                      ];
                    }
                  } finally {
                    this.pdfium.pdfium.wasmExports.free(matrixPtr);
                  }
                }

                const applyMatrix = (px: number, py: number): { x: number; y: number } => {
                  if (!matrix) return { x: px, y: py };
                  const [a, b, c, d, e, f] = matrix;
                  return {
                    x: a * px + c * py + e,
                    y: b * px + d * py + f
                  };
                };

                let fillMode = 0;
                let strokeFlag = 0;
                if (typeof this.pdfium.FPDFPath_GetDrawMode === 'function') {
                  const okMode = this.pdfium.FPDFPath_GetDrawMode(obj, fillModePtr, strokeFlagPtr);
                  if (okMode) {
                    fillMode = this.readInt32(fillModePtr);
                    strokeFlag = this.readInt32(strokeFlagPtr);
                  }
                }

                let stroke: string | undefined;
                let strokeOpacity: number | undefined;
                if (typeof this.pdfium.FPDFPageObj_GetStrokeColor === 'function') {
                  const ok = this.pdfium.FPDFPageObj_GetStrokeColor(obj, rPtr, gPtr, bPtr, aPtr);
                  if (ok) {
                    const rr = this.readUInt32(rPtr);
                    const gg = this.readUInt32(gPtr);
                    const bb = this.readUInt32(bPtr);
                    const aa = this.readUInt32(aPtr);
                    stroke = this.rgbToHex(rr, gg, bb);
                    strokeOpacity = aa / 255;
                  }
                }

                let fill: string | undefined;
                let fillOpacity: number | undefined;
                if (typeof this.pdfium.FPDFPageObj_GetFillColor === 'function') {
                  const ok = this.pdfium.FPDFPageObj_GetFillColor(obj, rPtr, gPtr, bPtr, aPtr);
                  if (ok) {
                    const rr = this.readUInt32(rPtr);
                    const gg = this.readUInt32(gPtr);
                    const bb = this.readUInt32(bPtr);
                    const aa = this.readUInt32(aPtr);
                    fill = this.rgbToHex(rr, gg, bb);
                    fillOpacity = aa / 255;
                  }
                }

                let strokeWidth: number | undefined;
                if (typeof this.pdfium.FPDFPageObj_GetStrokeWidth === 'function') {
                  const ok = this.pdfium.FPDFPageObj_GetStrokeWidth(obj, widthPtr);
                  if (ok) strokeWidth = this.readFloat32(widthPtr);
                }

                const cap = typeof this.pdfium.FPDFPageObj_GetLineCap === 'function' ? this.pdfium.FPDFPageObj_GetLineCap(obj) : -1;
                const join = typeof this.pdfium.FPDFPageObj_GetLineJoin === 'function' ? this.pdfium.FPDFPageObj_GetLineJoin(obj) : -1;

                const segCount = this.pdfium.FPDFPath_CountSegments(obj);
                if (!segCount || segCount < 1) continue;

                const segments: Array<{ type: number; close: number; x: number; y: number }> = [];
                let minRawX = Number.POSITIVE_INFINITY;
                let minRawY = Number.POSITIVE_INFINITY;
                let maxRawX = Number.NEGATIVE_INFINITY;
                let maxRawY = Number.NEGATIVE_INFINITY;
                let minMatX = Number.POSITIVE_INFINITY;
                let minMatY = Number.POSITIVE_INFINITY;
                let maxMatX = Number.NEGATIVE_INFINITY;
                let maxMatY = Number.NEGATIVE_INFINITY;

                for (let si = 0; si < segCount; si++) {
                  const seg = this.pdfium.FPDFPath_GetPathSegment(obj, si);
                  if (!seg) continue;

                  const okPt = this.pdfium.FPDFPathSegment_GetPoint(seg, xPtr, yPtr);
                  if (!okPt) continue;

                  const xRaw = this.readFloat32(xPtr);
                  const yRaw = this.readFloat32(yPtr);
                  const segType = this.pdfium.FPDFPathSegment_GetType(seg);
                  const close = this.pdfium.FPDFPathSegment_GetClose(seg);

                  segments.push({ type: segType, close, x: xRaw, y: yRaw });

                  minRawX = Math.min(minRawX, xRaw);
                  minRawY = Math.min(minRawY, yRaw);
                  maxRawX = Math.max(maxRawX, xRaw);
                  maxRawY = Math.max(maxRawY, yRaw);

                  const pMat = applyMatrix(xRaw, yRaw);
                  minMatX = Math.min(minMatX, pMat.x);
                  minMatY = Math.min(minMatY, pMat.y);
                  maxMatX = Math.max(maxMatX, pMat.x);
                  maxMatY = Math.max(maxMatY, pMat.y);
                }

                if (segments.length === 0) continue;

                let useMatrixPoints = false;
                if (matrix) {
                  const okBounds = this.pdfium.FPDFPageObj_GetBounds(obj, leftPtr, bottomPtr, rightPtr, topPtr);
                  if (okBounds) {
                    const bLeft = this.readFloat32(leftPtr);
                    const bBottom = this.readFloat32(bottomPtr);
                    const bRight = this.readFloat32(rightPtr);
                    const bTop = this.readFloat32(topPtr);

                    const errorRaw =
                      Math.abs(minRawX - bLeft) +
                      Math.abs(minRawY - bBottom) +
                      Math.abs(maxRawX - bRight) +
                      Math.abs(maxRawY - bTop);

                    const errorMat =
                      Math.abs(minMatX - bLeft) +
                      Math.abs(minMatY - bBottom) +
                      Math.abs(maxMatX - bRight) +
                      Math.abs(maxMatY - bTop);

                    useMatrixPoints = errorMat < errorRaw;
                  } else {
                    useMatrixPoints = true;
                  }
                }

                const d: string[] = [];
                let pendingBezier: Array<{ x: number; y: number }> = [];

                const flushBezier = (): void => {
                  if (pendingBezier.length >= 3) {
                    const [c1, c2, p] = pendingBezier;
                    d.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`);
                  }
                  pendingBezier = [];
                };

                for (const seg of segments) {
                  const pPdf = useMatrixPoints ? applyMatrix(seg.x, seg.y) : { x: seg.x, y: seg.y };
                  const x = pPdf.x;
                  const y = height - pPdf.y;

                  if (seg.type === 2) {
                    flushBezier();
                    d.push(`M ${x} ${y}`);
                  } else if (seg.type === 0) {
                    flushBezier();
                    d.push(`L ${x} ${y}`);
                  } else if (seg.type === 1) {
                    pendingBezier.push({ x, y });
                    if (pendingBezier.length === 3) {
                      flushBezier();
                    }
                  }

                  if (seg.close) {
                    flushBezier();
                    d.push('Z');
                  }
                }

                flushBezier();

                if (d.length === 0) continue;

                const isFilled = fillMode !== 0;
                const isStroked = strokeFlag !== 0;

                page.content.graphics.push({
                  type: 'path',
                  path: d.join(' '),
                  stroke: isStroked ? stroke || '#000000' : undefined,
                  strokeWidth: isStroked ? strokeWidth || 1 : undefined,
                  strokeOpacity: isStroked ? strokeOpacity : undefined,
                  fill: isFilled ? fill || '#000000' : undefined,
                  fillRule: isFilled ? (fillMode === 1 ? 'evenodd' : 'nonzero') : undefined,
                  fillOpacity: isFilled ? fillOpacity : undefined,
                  lineCap: cap >= 0 ? this.mapLineCap(cap) : undefined,
                  lineJoin: join >= 0 ? this.mapLineJoin(join) : undefined
                });
              }
            } finally {
              this.pdfium.pdfium.wasmExports.free(xPtr);
              this.pdfium.pdfium.wasmExports.free(yPtr);
              this.pdfium.pdfium.wasmExports.free(leftPtr);
              this.pdfium.pdfium.wasmExports.free(bottomPtr);
              this.pdfium.pdfium.wasmExports.free(rightPtr);
              this.pdfium.pdfium.wasmExports.free(topPtr);
              this.pdfium.pdfium.wasmExports.free(fillModePtr);
              this.pdfium.pdfium.wasmExports.free(strokeFlagPtr);
              this.pdfium.pdfium.wasmExports.free(rPtr);
              this.pdfium.pdfium.wasmExports.free(gPtr);
              this.pdfium.pdfium.wasmExports.free(bPtr);
              this.pdfium.pdfium.wasmExports.free(aPtr);
              this.pdfium.pdfium.wasmExports.free(widthPtr);
            }
          }
        } catch (error) {
          console.debug('PDFium graphics extraction failed:', error);
        }
      }

      if (options.extractImages) {
        try {
          const objCount = this.pdfium.FPDFPage_CountObjects(pagePtr);
          const leftPtr = this.allocFloat32();
          const bottomPtr = this.allocFloat32();
          const rightPtr = this.allocFloat32();
          const topPtr = this.allocFloat32();
          try {
            const decoder = new TextDecoder('utf-8');
            for (let i = 0; i < objCount; i++) {
              const obj = this.pdfium.FPDFPage_GetObject(pagePtr, i);
              if (!obj) continue;
              const t = this.pdfium.FPDFPageObj_GetType(obj);
              if (t !== 3) continue;

              const okBounds = this.pdfium.FPDFPageObj_GetBounds(obj, leftPtr, bottomPtr, rightPtr, topPtr);
              const left = okBounds ? this.readFloat32(leftPtr) : 0;
              const bottom = okBounds ? this.readFloat32(bottomPtr) : 0;
              const right = okBounds ? this.readFloat32(rightPtr) : 0;
              const top = okBounds ? this.readFloat32(topPtr) : 0;

              const x = left;
              const y = bottom;
              const w = Math.max(0, right - left);
              const h = Math.max(0, top - bottom);

              let matrix: [number, number, number, number, number, number] | undefined;
              let rotation: number | undefined;
              if (typeof this.pdfium.FPDFPageObj_GetMatrix === 'function') {
                const matrixPtr = this.pdfium.pdfium.wasmExports.malloc(24);
                try {
                  const ok = this.pdfium.FPDFPageObj_GetMatrix(obj, matrixPtr);
                  if (ok) {
                    const dv = new DataView(
                      this.pdfium.pdfium.HEAPU8.buffer,
                      this.pdfium.pdfium.HEAPU8.byteOffset + matrixPtr,
                      24
                    );
                    const a = dv.getFloat32(0, true);
                    const b = dv.getFloat32(4, true);
                    const c = dv.getFloat32(8, true);
                    const d = dv.getFloat32(12, true);
                    const e = dv.getFloat32(16, true);
                    const f = dv.getFloat32(20, true);
                    matrix = [a, b, c, d, e, f];
                    const angleRad = Math.atan2(b, a);
                    const deg = (angleRad * 180) / Math.PI;
                    rotation = Number.isFinite(deg) && Math.abs(deg) > 0.01 ? deg : undefined;
                  }
                } finally {
                  this.pdfium.pdfium.wasmExports.free(matrixPtr);
                }
              }

              let filters: string[] | undefined;
              if (typeof this.pdfium.FPDFImageObj_GetImageFilterCount === 'function' && typeof this.pdfium.FPDFImageObj_GetImageFilter === 'function') {
                const count = this.pdfium.FPDFImageObj_GetImageFilterCount(obj);
                if (count > 0 && count < 50) {
                  filters = [];
                  for (let fi = 0; fi < count; fi++) {
                    const len = this.pdfium.FPDFImageObj_GetImageFilter(obj, fi, 0, 0);
                    if (!len || len <= 0 || len > 4096) continue;
                    const bufPtr = this.pdfium.pdfium.wasmExports.malloc(len);
                    try {
                      const got = this.pdfium.FPDFImageObj_GetImageFilter(obj, fi, bufPtr, len);
                      const bytes = new Uint8Array(
                        this.pdfium.pdfium.HEAPU8.buffer,
                        this.pdfium.pdfium.HEAPU8.byteOffset + bufPtr,
                        Math.min(got || len, len)
                      ).filter((v) => v !== 0);
                      const name = decoder.decode(bytes);
                      if (name) filters.push(name);
                    } finally {
                      this.pdfium.pdfium.wasmExports.free(bufPtr);
                    }
                  }
                  if (filters.length === 0) filters = undefined;
                }
              }

              let imagePixelWidth: number | undefined;
              let imagePixelHeight: number | undefined;
              let dpi: number | undefined;
              let bitsPerPixel: number | undefined;
              let colorSpace: number | undefined;
              if (typeof this.pdfium.FPDFImageObj_GetImageMetadata === 'function') {
                const metaPtr = this.pdfium.pdfium.wasmExports.malloc(32);
                try {
                  const ok = this.pdfium.FPDFImageObj_GetImageMetadata(obj, pagePtr, metaPtr);
                  if (ok) {
                    const dv = new DataView(
                      this.pdfium.pdfium.HEAPU8.buffer,
                      this.pdfium.pdfium.HEAPU8.byteOffset + metaPtr,
                      32
                    );
                    imagePixelWidth = dv.getUint32(0, true);
                    imagePixelHeight = dv.getUint32(4, true);
                    const hdpi = dv.getFloat32(8, true);
                    const vdpi = dv.getFloat32(12, true);
                    const avgDpi = (hdpi + vdpi) / 2;
                    dpi = Number.isFinite(avgDpi) && avgDpi > 0 ? avgDpi : undefined;
                    bitsPerPixel = dv.getUint32(16, true);
                    colorSpace = dv.getInt32(20, true);
                  }
                } finally {
                  this.pdfium.pdfium.wasmExports.free(metaPtr);
                }
              }

              let rawData: ArrayBuffer | undefined;
              if (typeof this.pdfium.FPDFImageObj_GetImageDataRaw === 'function') {
                const rawLen = this.pdfium.FPDFImageObj_GetImageDataRaw(obj, 0, 0);
                if (rawLen > 0 && rawLen < 200_000_000) {
                  const rawPtr = this.pdfium.pdfium.wasmExports.malloc(rawLen);
                  try {
                    this.pdfium.FPDFImageObj_GetImageDataRaw(obj, rawPtr, rawLen);
                    rawData = new Uint8Array(
                      this.pdfium.pdfium.HEAPU8.buffer,
                      this.pdfium.pdfium.HEAPU8.byteOffset + rawPtr,
                      rawLen
                    ).slice().buffer;
                  } finally {
                    this.pdfium.pdfium.wasmExports.free(rawPtr);
                  }
                }
              }

              let decodedData: ArrayBuffer | undefined;
              if (typeof this.pdfium.FPDFImageObj_GetImageDataDecoded === 'function') {
                const decLen = this.pdfium.FPDFImageObj_GetImageDataDecoded(obj, 0, 0);
                if (decLen > 0 && decLen < 200_000_000) {
                  const decPtr = this.pdfium.pdfium.wasmExports.malloc(decLen);
                  try {
                    this.pdfium.FPDFImageObj_GetImageDataDecoded(obj, decPtr, decLen);
                    decodedData = new Uint8Array(
                      this.pdfium.pdfium.HEAPU8.buffer,
                      this.pdfium.pdfium.HEAPU8.byteOffset + decPtr,
                      decLen
                    ).slice().buffer;
                  } finally {
                    this.pdfium.pdfium.wasmExports.free(decPtr);
                  }
                }
              }

              let bmp = 0;
              try {
                bmp = this.pdfium.FPDFImageObj_GetRenderedBitmap(this.document.docPtr, pagePtr, obj);
              } catch {
                bmp = 0;
              }
              if (!bmp) {
                try {
                  bmp = this.pdfium.FPDFImageObj_GetBitmap(obj);
                } catch {
                  bmp = 0;
                }
              }
              if (!bmp) continue;

              try {
                const bw = this.pdfium.FPDFBitmap_GetWidth(bmp);
                const bh = this.pdfium.FPDFBitmap_GetHeight(bmp);
                const stride = this.pdfium.FPDFBitmap_GetStride(bmp);
                let format = typeof this.pdfium.FPDFBitmap_GetFormat === 'function' ? this.pdfium.FPDFBitmap_GetFormat(bmp) : 0;
                const bufPtr = this.pdfium.FPDFBitmap_GetBuffer(bmp);
                if (!bufPtr || bw <= 0 || bh <= 0 || stride <= 0) continue;

                // Some builds don't expose FPDFBitmap_GetFormat. Infer from stride.
                // NOTE: stride can include padding, so use floor.
                if (!format) {
                  const bytesPerPixelFloor = Math.max(1, Math.floor(stride / bw));
                  if (bytesPerPixelFloor <= 1) {
                    format = 1;
                  } else if (bytesPerPixelFloor === 3) {
                    format = 2;
                  } else {
                    format = 4;
                  }
                }

                const bufSize = stride * bh;
                const bgra = new Uint8Array(
                  this.pdfium.pdfium.HEAPU8.buffer,
                  this.pdfium.pdfium.HEAPU8.byteOffset + bufPtr,
                  bufSize
                ).slice();

                const rgbaPacked = this.bitmapToRgbaPacked(bgra, bw, bh, stride, format);
                const dataUrl = this.rgbaToDataUrl(rgbaPacked, bw, bh);

                page.content.images.push({
                  data: dataUrl,
                  format: 'png',
                  x,
                  y,
                  width: w || bw,
                  height: h || bh,
                  dpi,
                  rotation,
                  matrix,
                  filters,
                  rawData,
                  decodedData,
                  pixelWidth: imagePixelWidth,
                  pixelHeight: imagePixelHeight,
                  bitsPerPixel,
                  colorSpace
                });
              } finally {
                try {
                  this.pdfium.FPDFBitmap_Destroy(bmp);
                } catch {
                  // ignore
                }
              }
            }
          } finally {
            this.pdfium.pdfium.wasmExports.free(topPtr);
            this.pdfium.pdfium.wasmExports.free(rightPtr);
            this.pdfium.pdfium.wasmExports.free(bottomPtr);
            this.pdfium.pdfium.wasmExports.free(leftPtr);
          }
        } catch (error) {
          console.debug('PDFium image extraction failed:', error);
        }
      }

      if (options.extractGraphics) {
        if (this.enableFullPageRasterFallback) {
          console.debug('PDFium full-page raster fallback is not enabled');
        }
      }

      return page;
    } finally {
      try {
        this.pdfium.FPDF_ClosePage(pagePtr);
      } catch {
        // ignore
      }
    }
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
    if (this.document && this.pdfium) {
      try {
        this.pdfium.FPDF_CloseDocument(this.document.docPtr);
      } catch {
        // ignore
      }
      try {
        this.pdfium.pdfium.wasmExports.free(this.document.filePtr);
      } catch {
        // ignore
      }
    }
    this.document = null;
  }
}
