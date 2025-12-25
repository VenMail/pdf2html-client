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

// Convenience configuration presets
export const ConfigPresets = {
  /**
   * Document editing and content extraction
   * Maximum editability with semantic structure
   */
  editing: {
    enableOCR: true,
    enableFontMapping: true,
    htmlOptions: {
      format: 'html+inline-css' as const,
      preserveLayout: false,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const,
      textLayout: 'flow' as const,
      includeExtractedText: true
    }
  } as PDF2HTMLConfig,

  /**
   * High-fidelity document display
   * Pixel-perfect positioning for archival and viewing
   */
  fidelity: {
    enableOCR: false,
    enableFontMapping: true,
    htmlOptions: {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: false,
      darkMode: false,
      imageFormat: 'base64' as const,
      textLayout: 'absolute' as const,
      textLayoutPasses: 1,
      textPipeline: 'legacy' as const
    }
  } as PDF2HTMLConfig,

  /**
   * Web-optimized responsive documents
   * Modern, accessible, and performance-optimized
   */
  web: {
    enableOCR: true,
    enableFontMapping: false,
    htmlOptions: {
      format: 'html+css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: true,
      imageFormat: 'url' as const,
      textLayout: 'semantic' as const,
      useFlexboxLayout: true,
      semanticLayout: {
        blockGapFactor: 1.2,
        headingThreshold: 0.8
      }
    }
  } as PDF2HTMLConfig
};

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
        textLayout: 'semantic',
        textLayoutPasses: 1
      };
    }

    this.parser = new PDFParser(this.config.parserStrategy ?? 'auto');
    this.fontDetector = new FontDetector();

    if (this.config.enableFontMapping) {
      this.fontMapper = new FontMapper(this.config.fontMappingOptions);
    }

    this.htmlGenerator = new HTMLGenerator(
      this.config.htmlOptions || {},
      this.config.cssOptions
    );
  }

  // Chainable configuration methods
  enableOCR(enabled: boolean = true): this {
    this.config.enableOCR = enabled;
    return this;
  }

  enableFontMapping(enabled: boolean = true): this {
    this.config.enableFontMapping = enabled;
    if (enabled) {
      if (!this.fontMapper) {
        this.fontMapper = new FontMapper(this.config.fontMappingOptions);
      }
    } else {
      // Clean up font mapper when disabled
      if (this.fontMapper) {
        this.fontMapper = null;
      }
    }
    return this;
  }

  setParserStrategy(strategy: 'auto' | 'pdfium' | 'unpdf'): this {
    // Dispose old parser before creating new one
    if (this.parser) {
      this.parser.dispose();
    }
    this.config.parserStrategy = strategy;
    this.parser = new PDFParser(strategy);
    return this;
  }

  setTextLayout(layout: 'absolute' | 'smart' | 'flow' | 'semantic'): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, textLayout: layout };
    return this;
  }

  setPreserveLayout(preserve: boolean): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, preserveLayout: preserve };
    return this;
  }

  setResponsive(responsive: boolean): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, responsive: responsive };
    return this;
  }

  setDarkMode(dark: boolean): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, darkMode: dark };
    return this;
  }

  setImageFormat(format: 'base64' | 'url'): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, imageFormat: format };
    return this;
  }

  setOutputFormat(format: 'html' | 'html+css' | 'html+inline-css'): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, format: format };
    return this;
  }

  includeExtractedText(include: boolean = true): this {
    const defaults = {
      format: 'html+inline-css' as const,
      preserveLayout: true,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64' as const
    };
    this.config.htmlOptions = { ...defaults, ...this.config.htmlOptions, includeExtractedText: include };
    return this;
  }

  setOCRConfig(config: NonNullable<PDF2HTMLConfig['ocrConfig']>): this {
    this.config.ocrConfig = config;
    return this;
  }

  setMaxConcurrentPages(max: number): this {
    this.config.maxConcurrentPages = max;
    return this;
  }

  // Apply a preset configuration
  applyPreset(preset: keyof typeof ConfigPresets): this {
    if (!ConfigPresets[preset]) {
      throw new Error(`Unknown preset: ${preset}. Available presets: ${Object.keys(ConfigPresets).join(', ')}`);
    }
    
    // Validate preset structure before applying
    const presetConfig = ConfigPresets[preset];
    if (!presetConfig || typeof presetConfig !== 'object') {
      throw new Error(`Invalid preset configuration for: ${preset}`);
    }
    
    // Apply preset with proper merging to preserve critical config properties
    const originalParserStrategy = this.config.parserStrategy;
    const originalMaxConcurrentPages = this.config.maxConcurrentPages;
    const originalCacheEnabled = this.config.cacheEnabled;
    
    Object.assign(this.config, presetConfig);
    
    // Restore critical properties that shouldn't be overridden by presets
    this.config.parserStrategy = originalParserStrategy || this.config.parserStrategy;
    this.config.maxConcurrentPages = originalMaxConcurrentPages || this.config.maxConcurrentPages;
    this.config.cacheEnabled = originalCacheEnabled !== undefined ? originalCacheEnabled : this.config.cacheEnabled;
    
    // Reinitialize components if needed
    if (presetConfig.enableFontMapping && !this.fontMapper) {
      this.fontMapper = new FontMapper(this.config.fontMappingOptions);
    } else if (!presetConfig.enableFontMapping && this.fontMapper) {
      this.fontMapper = null;
    }
    
    return this;
  }

  async convert(
    pdfData: ArrayBuffer | File,
    progressCallback?: ProgressCallback
  ): Promise<HTMLOutput> {
    const startTime = Date.now();

    // Set semantic mode flag for PDFParser to detect
    const g = globalThis as unknown as { 
      __PDF2HTML_SEMANTIC_MODE__?: boolean;
      __PDF2HTML_CONFIG__?: {
        htmlOptions?: {
          preserveLayout?: boolean;
          textLayout?: string;
        };
      };
    };
    
    // Store the config for PDFParser to access
    g.__PDF2HTML_CONFIG__ = {
      htmlOptions: this.config.htmlOptions
    };
    
    // Set semantic mode flag if conditions are met
    const isSemanticMode = this.config.htmlOptions?.preserveLayout === true && 
                          this.config.htmlOptions?.textLayout === 'semantic';
    g.__PDF2HTML_SEMANTIC_MODE__ = isSemanticMode;

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

    // Clean up global flags
    if (g) {
      delete g.__PDF2HTML_SEMANTIC_MODE__;
      delete g.__PDF2HTML_CONFIG__;
    }

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

  // Static factory methods for common use cases
  static forEditing(): PDF2HTML {
    return new PDF2HTML(ConfigPresets.editing);
  }

  static forFidelity(): PDF2HTML {
    return new PDF2HTML(ConfigPresets.fidelity);
  }

  static forWeb(): PDF2HTML {
    return new PDF2HTML(ConfigPresets.web);
  }

  // Static convenience methods for one-liner conversion
  static async convertForEditing(
    pdfData: ArrayBuffer | File,
    progressCallback?: ProgressCallback
  ): Promise<HTMLOutput> {
    const converter = PDF2HTML.forEditing();
    try {
      return await converter.convert(pdfData, progressCallback);
    } finally {
      converter.dispose();
    }
  }

  static async convertForFidelity(
    pdfData: ArrayBuffer | File,
    progressCallback?: ProgressCallback
  ): Promise<HTMLOutput> {
    const converter = PDF2HTML.forFidelity();
    try {
      return await converter.convert(pdfData, progressCallback);
    } finally {
      converter.dispose();
    }
  }

  static async convertForWeb(
    pdfData: ArrayBuffer | File,
    progressCallback?: ProgressCallback
  ): Promise<HTMLOutput> {
    const converter = PDF2HTML.forWeb();
    try {
      return await converter.convert(pdfData, progressCallback);
    } finally {
      converter.dispose();
    }
  }

  // Auto-detection method for optimal configuration
  static async suggestOptimalConfig(
    pdfData: ArrayBuffer | File
  ): Promise<{ preset: keyof typeof ConfigPresets; reason: string }> {
    // Convert File to ArrayBuffer if needed
    const arrayBuffer = pdfData instanceof File ? await pdfData.arrayBuffer() : pdfData;
    
    // Quick analysis without full conversion
    const parser = new PDFParser('auto');
    let document = null;
    
    try {
      document = await parser.parse(arrayBuffer, {
        extractText: true,
        extractImages: true,
        extractGraphics: false,
        extractForms: false,
        extractAnnotations: false
      });
      
      // Detect if this is a scanned PDF
      const { ScannedPDFDetector } = await import('./core/scanned-pdf-detector.js');
      const detector = new ScannedPDFDetector();
      const scanAnalysis = detector.analyze(document);
      
      // Analyze document characteristics
      const pageCount = document.pageCount;
      const totalImages = document.pages.reduce((sum, page) => sum + page.content.images.length, 0);
      const totalText = document.pages.reduce((sum, page) => sum + page.content.text.length, 0);
      const hasComplexLayout = document.pages.some(page => 
        page.content.text.length > 50 && page.content.images.length > 0
      );
      
      // Decision logic
      if (scanAnalysis.isScanned) {
        return {
          preset: 'editing',
          reason: 'Document appears to be scanned - OCR enabled for text extraction'
        };
      }
      
      if (pageCount === 1 && totalImages > 5) {
        return {
          preset: 'fidelity',
          reason: 'Single page with many images - high-fidelity mode recommended'
        };
      }
      
      if (hasComplexLayout || pageCount > 10) {
        return {
          preset: 'web',
          reason: 'Complex layout detected - web-optimized responsive mode recommended'
        };
      }
      
      if (totalText > 1000) {
        return {
          preset: 'editing',
          reason: 'Text-heavy document - editing mode for better content extraction'
        };
      }
      
      // Default to web for general use
      return {
        preset: 'web',
        reason: 'General document - web-optimized mode provides best balance'
      };
    } finally {
      // Always dispose parser, even if an error occurs
      parser.dispose();
    }
  }

  // Auto-convert with optimal configuration
  static async convertAuto(
    pdfData: ArrayBuffer | File,
    progressCallback?: ProgressCallback
  ): Promise<{ result: HTMLOutput; presetUsed: keyof typeof ConfigPresets; reason: string }> {
    const suggestion = await PDF2HTML.suggestOptimalConfig(pdfData);
    
    let result: HTMLOutput;
    switch (suggestion.preset) {
      case 'editing':
        result = await PDF2HTML.convertForEditing(pdfData, progressCallback);
        break;
      case 'fidelity':
        result = await PDF2HTML.convertForFidelity(pdfData, progressCallback);
        break;
      case 'web':
        result = await PDF2HTML.convertForWeb(pdfData, progressCallback);
        break;

      default:
        throw new Error(`Unknown preset: ${suggestion.preset}`);
    }
    
    return {
      result,
      presetUsed: suggestion.preset,
      reason: suggestion.reason
    };
  }
}

export * from './types/index.js';
export * from './core/index.js';
export * from './ocr/index.js';
export * from './fonts/index.js';
export * from './html/index.js';

