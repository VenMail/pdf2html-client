import type { PDFDocument, PDFParserOptions } from '../types/pdf.js';
import { PDFiumWrapper } from './pdfium-wrapper.js';
import { PDFJSWrapper } from './pdfjs-wrapper.js';

export type ParserStrategy = 'pdfium' | 'pdfjs' | 'auto';

export class PDFParser {
  private pdfiumWrapper: PDFiumWrapper;
  private pdfjsWrapper: PDFJSWrapper;
  private strategy: ParserStrategy;
  private pdfiumAvailable: boolean = false;

  constructor(strategy: ParserStrategy = 'auto') {
    this.strategy = strategy;
    this.pdfiumWrapper = new PDFiumWrapper();
    this.pdfjsWrapper = new PDFJSWrapper();
  }

  async initialize(): Promise<void> {
    if (this.strategy === 'auto' || this.strategy === 'pdfium') {
      try {
        await this.pdfiumWrapper.initialize();
        this.pdfiumAvailable = true;
      } catch (error) {
        console.warn('PDFium initialization failed, falling back to pdf.js:', error);
        this.pdfiumAvailable = false;
      }
    }
  }

  async parse(
    data: ArrayBuffer,
    options: PDFParserOptions = {
      extractText: true,
      extractImages: true,
      extractGraphics: false,
      extractForms: false,
      extractAnnotations: false
    }
  ): Promise<PDFDocument> {
    await this.initialize();

    // Prefer PDF.js for graphics extraction since it handles SVG/vector content better
    const usePDFium =
      this.strategy === 'pdfium' ||
      (this.strategy === 'auto' && this.pdfiumAvailable && !options.extractGraphics);

    if (usePDFium) {
      try {
        return await this.pdfiumWrapper.parseDocument(data, options);
      } catch (error) {
        console.warn('PDFium parsing failed, falling back to pdf.js:', error);
        return await this.pdfjsWrapper.parseDocument(data, options);
      }
    }

    return await this.pdfjsWrapper.parseDocument(data, options);
  }

  async parseParallel(
    data: ArrayBuffer,
    options: PDFParserOptions = {
      extractText: true,
      extractImages: true,
      extractGraphics: false,
      extractForms: false,
      extractAnnotations: false
    },
    maxConcurrent: number = 4
  ): Promise<PDFDocument> {
    await this.initialize();

    const usePDFium =
      this.strategy === 'pdfium' ||
      (this.strategy === 'auto' && this.pdfiumAvailable);

    if (usePDFium) {
      try {
        await this.pdfiumWrapper.loadDocument(data);
        const pageCount = await this.pdfiumWrapper.getPageCount();
        const pages = await this.parsePagesParallel(
          (pageNum) => this.pdfiumWrapper.parsePage(pageNum, options),
          pageCount,
          maxConcurrent
        );

        return {
          pageCount,
          metadata: {},
          pages
        };
      } catch (error) {
        console.warn('PDFium parallel parsing failed, falling back to pdf.js:', error);
      }
    }

    await this.pdfjsWrapper.loadDocument(data);
    const pageCount = await this.pdfjsWrapper.getPageCount();
    const pages = await this.parsePagesParallel(
      (pageNum) => this.pdfjsWrapper.parsePage(pageNum, options),
      pageCount,
      maxConcurrent
    );

    return {
      pageCount,
      metadata: {},
      pages
    };
  }

  private async parsePagesParallel<T>(
    parseFn: (pageNum: number) => Promise<T>,
    pageCount: number,
    maxConcurrent: number
  ): Promise<T[]> {
    // Initialize results array with proper length to avoid sparse array issues
    const results: (T | undefined)[] = new Array(pageCount);
    const queue: Array<Promise<void>> = [];

    for (let i = 0; i < pageCount; i++) {
      const pageIndex = i;
      const promise = parseFn(pageIndex)
        .then((result) => {
          results[pageIndex] = result;
        })
        .catch((error) => {
          console.error(`Failed to parse page ${pageIndex}:`, error);
          // Set to undefined so we can detect missing pages
          results[pageIndex] = undefined;
        });

      queue.push(promise);

      if (queue.length >= maxConcurrent) {
        await Promise.race(queue);
        const completedIndex = queue.findIndex((p) => p === promise);
        if (completedIndex !== -1) {
          queue.splice(completedIndex, 1);
        }
      }
    }

    // Wait for all remaining promises to complete
    await Promise.all(queue);
    
    // Ensure all pages are present in correct order
    // Check for any missing pages and log warnings
    const finalResults: T[] = [];
    for (let i = 0; i < pageCount; i++) {
      if (results[i] === undefined) {
        console.error(`Page ${i} is missing from results array - this will cause pages to be skipped`);
        // This is a critical error - we cannot proceed with missing pages
        // as it will break page numbering and cause pages to be skipped
        throw new Error(`Page ${i} failed to parse. All pages must be successfully parsed.`);
      }
      finalResults.push(results[i] as T);
    }
    
    // Verify we have the correct number of pages
    if (finalResults.length !== pageCount) {
      console.error(`Page count mismatch: expected ${pageCount}, got ${finalResults.length}`);
      throw new Error(`Page count mismatch: expected ${pageCount} pages, but only ${finalResults.length} were parsed`);
    }
    
    return finalResults;
  }

  dispose(): void {
    this.pdfiumWrapper.dispose();
    this.pdfjsWrapper.dispose();
  }
}


