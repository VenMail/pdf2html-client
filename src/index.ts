import type {
  PDF2HTMLConfig,
  HTMLOutput,
  ConversionProgress,
  ProgressCallback
} from './types/index.js';
import type { OCRResult } from './types/ocr.js';
import type { OCRPageResult } from './types/ocr.js';
import { PDFParser } from './core/pdf-parser.js';
import { RegionLayoutAnalyzer } from './core/region-layout.js';
import { FontDetector } from './fonts/font-detector.js';
import { FontMapper } from './fonts/font-mapper.js';
import { HTMLGenerator } from './html/html-generator.js';

import type { OCREngine } from './ocr/ocr-engine.js';
import type { OCRProcessor } from './ocr/ocr-processor.js';

export class PDF2HTML {
  private config: PDF2HTMLConfig;
  private parser: PDFParser;
  private ocrEngine: OCREngine | null = null; // Lazy loaded
  private ocrProcessor: OCRProcessor | null = null; // Lazy loaded
  private fontDetector: FontDetector;
  private fontMapper: FontMapper | null = null;
  private htmlGenerator: HTMLGenerator;

  constructor(config: PDF2HTMLConfig = {
    enableOCR: false,
    enableFontMapping: false
  }) {
    this.config = {
      maxConcurrentPages: 4,
      cacheEnabled: true,
      ...config
    };

    // Set default HTML options if not provided
    if (!this.config.htmlOptions) {
      this.config.htmlOptions = {
        format: 'html+inline-css',
        preserveLayout: true,
        responsive: true,
        darkMode: false,
        imageFormat: 'base64',
        textLayout: 'absolute',
        textLayoutPasses: 1
      };
    }

    this.parser = new PDFParser(this.config.parserStrategy ?? 'auto');
    this.fontDetector = new FontDetector();

    if (this.config.enableFontMapping) {
      // Get API key from environment or config
      const apiKey =
        typeof process !== 'undefined' &&
        typeof (process as unknown as { env?: { GOOGLE_API_KEY?: string } }).env?.GOOGLE_API_KEY === 'string'
          ? (process as unknown as { env: { GOOGLE_API_KEY: string } }).env.GOOGLE_API_KEY
          : typeof window !== 'undefined' &&
              typeof (window as unknown as { __GOOGLE_API_KEY__?: string }).__GOOGLE_API_KEY__ === 'string'
            ? (window as unknown as { __GOOGLE_API_KEY__: string }).__GOOGLE_API_KEY__
            : undefined;
      
      this.fontMapper = new FontMapper(this.config.fontMappingOptions, apiKey);
    }

    this.htmlGenerator = new HTMLGenerator(
      this.config.htmlOptions || {},
      this.config.cssOptions
    );
  }

  async convert(
    pdfData: ArrayBuffer | File,
    progressCallback?: ProgressCallback
  ): Promise<HTMLOutput> {
    const startTime = Date.now();

    this.reportProgress(progressCallback, {
      stage: 'parsing',
      progress: 0,
      message: 'Parsing PDF document...'
    });

    // Convert File to ArrayBuffer if needed
    const arrayBuffer = pdfData instanceof File
      ? await pdfData.arrayBuffer()
      : pdfData;

    // Parse PDF
    const document = await this.parser.parse(
      arrayBuffer,
      this.config.parserOptions || {
        extractText: true,
        extractImages: true,
        extractGraphics: true,
        extractForms: false,
        extractAnnotations: false
      }
    );

    try {
      const g = globalThis as unknown as {
        __PDF2HTML_DEBUG_DECODE__?: boolean;
        __PDF2HTML_DECODE_ARTIFACT__?: unknown;
      };
      if (g.__PDF2HTML_DEBUG_DECODE__ === true) {
        g.__PDF2HTML_DECODE_ARTIFACT__ = {
          parserStrategy: this.config.parserStrategy ?? 'auto',
          document
        };
      }
    } catch {
      // ignore
    }

    this.reportProgress(progressCallback, {
      stage: 'parsing',
      progress: 100,
      totalPages: document.pageCount,
      message: `Parsed ${document.pageCount} pages`
    });

    // Detect if this is a scanned PDF (no text but has images)
    const { ScannedPDFDetector } = await import('./core/scanned-pdf-detector.js');
    const detector = new ScannedPDFDetector();
    const scanAnalysis = detector.analyze(document);

    // Process OCR only if:
    // 1. OCR is enabled
    // 2. PDF is detected as scanned (little text but has images)
    let ocrResults: OCRPageResult[] | null = null;
    if (this.config.enableOCR && scanAnalysis.isScanned) {
      const regionLayoutAnalyzer = new RegionLayoutAnalyzer();
      this.reportProgress(progressCallback, {
        stage: 'ocr',
        progress: 0,
        totalPages: document.pageCount,
        message: `Detected scanned PDF (confidence: ${(scanAnalysis.confidence * 100).toFixed(0)}%), running OCR...`
      });

      if (!this.ocrEngine) {
        // Lazy import OCREngine
        const { OCREngine } = await import('./ocr/ocr-engine.js');
        this.ocrEngine = new OCREngine(this.config.ocrConfig);
        await this.ocrEngine.initialize();
      }

      if (!this.ocrProcessor) {
        const { OCRProcessor } = await import('./ocr/ocr-processor.js');
        this.ocrProcessor = new OCRProcessor(this.ocrEngine!, this.config.ocrProcessorOptions);
      }

      ocrResults = await this.ocrProcessor!.processPages(document.pages);

      // Merge OCR results into document content
      for (const ocrPageResult of ocrResults) {
        const page = document.pages[ocrPageResult.pageNumber];
        if (page && ocrPageResult.results.length > 0) {
          // Convert OCR results to PDFTextContent
          const ocrWords = ocrPageResult.results.flatMap((result: OCRResult) => {
            if (Array.isArray(result.words) && result.words.length > 0) return result.words;
            return [
              {
                text: result.text,
                confidence: result.confidence,
                boundingBox: result.boundingBox
              }
            ];
          });

          const ocrTextContent = ocrWords.map((word) => {
            const bbox = word.boundingBox;
            return {
              text: word.text,
              x: bbox.x,
              y: bbox.y,
              width: bbox.width,
              height: bbox.height,
              fontSize: bbox.height * 0.8,
              fontFamily: 'Arial',
              fontWeight: 400,
              fontStyle: 'normal' as const,
              color: '#000000'
            };
          });

          ocrTextContent.sort((a, b) => {
            const yDiff = b.y - a.y;
            if (Math.abs(yDiff) > 1.5) return yDiff;
            return a.x - b.x;
          });

          const merged = regionLayoutAnalyzer.mergeTextRunsByLine({
            pageNumber: page.pageNumber,
            width: page.width,
            height: page.height,
            content: {
              text: ocrTextContent,
              images: [],
              graphics: [],
              forms: [],
              annotations: []
            }
          });
          
          page.content.text.push(...merged);
        }
      }

      this.reportProgress(progressCallback, {
        stage: 'ocr',
        progress: 100,
        message: 'OCR completed'
      });
    } else if (this.config.enableOCR && !scanAnalysis.isScanned) {
      this.reportProgress(progressCallback, {
        stage: 'ocr',
        progress: 100,
        message: `PDF appears to have text content (${scanAnalysis.totalTextLength} chars, ${scanAnalysis.totalImageCount} images). Skipping OCR - use only for scanned PDFs.`
      });
    }

    // Detect and map fonts
    let fontMappings: Awaited<ReturnType<FontMapper['mapFonts']>> = [];
    if (this.config.enableFontMapping && this.fontMapper) {
      this.reportProgress(progressCallback, {
        stage: 'font-mapping',
        progress: 0,
        message: 'Detecting fonts...'
      });

      const detectedFonts = this.fontDetector.detectFromTextContent(
        document.pages.flatMap((p) => p.content.text)
      );

      this.reportProgress(progressCallback, {
        stage: 'font-mapping',
        progress: 50,
        message: `Mapping ${detectedFonts.length} fonts to Google Fonts...`
      });

      fontMappings = await this.fontMapper.mapFonts(detectedFonts);

      this.reportProgress(progressCallback, {
        stage: 'font-mapping',
        progress: 100,
        message: 'Font mapping completed'
      });
    }

    // Generate HTML
    this.reportProgress(progressCallback, {
      stage: 'html-generation',
      progress: 0,
      message: 'Generating HTML output...'
    });

    const imageStats = (() => {
      const totalPages = document.pageCount;
      let totalImages = 0;
      let positionedImages = 0;
      let fullPageRasterImages = 0;
      let rasterGraphics = 0;

      for (const page of document.pages) {
        totalImages += page.content.images.length;

        for (const img of page.content.images) {
          const isFullPage =
            img.x === 0 &&
            img.y === 0 &&
            Math.abs(img.width - page.width) < 1 &&
            Math.abs(img.height - page.height) < 1;
          if (isFullPage) {
            fullPageRasterImages += 1;
          } else {
            positionedImages += 1;
          }
        }

        for (const g of page.content.graphics) {
          if (g.type === 'raster') rasterGraphics += 1;
        }
      }

      return {
        totalPages,
        totalImages,
        positionedImages,
        fullPageRasterImages,
        rasterGraphics
      };
    })();

    const metadata = {
      pageCount: document.pageCount,
      processingTime: Date.now() - startTime,
      ocrUsed: this.config.enableOCR && scanAnalysis.isScanned,
      fontMappings: fontMappings.length,
      originalMetadata: document.metadata as Record<string, unknown>,
      scannedPDF: scanAnalysis.isScanned,
      scanConfidence: scanAnalysis.confidence,
      imageStats
    };

    const output = this.htmlGenerator.generate(document, fontMappings, metadata);

    this.reportProgress(progressCallback, {
      stage: 'complete',
      progress: 100,
      message: 'Conversion completed'
    });

    return output;
  }

  private reportProgress(
    callback: ProgressCallback | undefined,
    progress: ConversionProgress
  ): void {
    if (callback) {
      callback(progress);
    }
  }

  dispose(): void {
    this.parser.dispose();
    if (this.ocrEngine && this.ocrEngine.dispose) {
      this.ocrEngine.dispose();
    }
  }
}

export * from './types/index.js';
export * from './core/index.js';
export * from './ocr/index.js';
export * from './fonts/index.js';
export * from './html/index.js';

