import type { PDFDocument, PDFParserOptions } from '../types/pdf.js';
import { PDFiumWrapper } from './pdfium-wrapper.js';
import { UnPDFWrapper } from './unpdf-wrapper.js';

export type ParserStrategy = 'auto' | 'pdfium' | 'unpdf';

export class PDFParser {
  private pdfiumWrapper: PDFiumWrapper;
  private unpdfWrapper: UnPDFWrapper | null = null;
  private strategy: ParserStrategy;

  constructor(strategy: ParserStrategy = 'auto') {
    this.strategy = strategy;
    this.pdfiumWrapper = new PDFiumWrapper();
  }

  async initialize(): Promise<void> {
    if (this.strategy === 'unpdf') {
      if (!this.unpdfWrapper) this.unpdfWrapper = new UnPDFWrapper();
      return;
    }
    await this.pdfiumWrapper.initialize();
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
    if (this.strategy === 'unpdf') {
      await this.initialize();
      if (!this.unpdfWrapper) this.unpdfWrapper = new UnPDFWrapper();
      return await this.unpdfWrapper.parseDocument(data, options);
    }

    await this.initialize();
    if (this.strategy === 'pdfium') {
      return await this.pdfiumWrapper.parseDocument(data, options);
    }

    try {
      return await this.pdfiumWrapper.parseDocument(data, options);
    } catch (error) {
      console.warn('PDFium parse failed; falling back to UnPDF:', error);
      if (!this.unpdfWrapper) this.unpdfWrapper = new UnPDFWrapper();
      return await this.unpdfWrapper.parseDocument(data, options);
    }
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
    if (this.strategy === 'unpdf') {
      throw new Error('parseParallel is not supported for UnPDF backend');
    }

    await this.initialize();

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
    this.unpdfWrapper?.dispose();
    this.unpdfWrapper = null;
  }
}
