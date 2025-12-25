import type { PDFDocument, PDFParserOptions } from '../types/pdf.js';
import { PDFiumWrapper } from './pdfium-wrapper.js';
import { UnPDFWrapper } from './unpdf-wrapper.js';
import { EnhancedTextStyler } from './enhanced-text-styler.js';

export type ParserStrategy = 'auto' | 'pdfium' | 'unpdf';

export class PDFParser {
  private pdfiumWrapper: PDFiumWrapper;
  private unpdfWrapper: UnPDFWrapper | null = null;
  private strategy: ParserStrategy;

  private scoreTextQuality(document: PDFDocument): number {
    const pages = document.pages || [];
    const textItems = pages.flatMap((p) => p.content?.text || []);
    const texts = textItems.map((t) => String(t.text || ''));
    const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length < 80) return 1;

    const alphaItems = textItems
      .map((t) => String(t.text || '').trim())
      .filter((t) => t.length > 0)
      .filter((t) => /[A-Za-z]/.test(t));
    const alphaItemCount = Math.max(1, alphaItems.length);
    const alphaShortItems = alphaItems.filter((t) => /^[A-Za-z]{1,2}$/.test(t)).length;
    const alphaShortItemRatio = alphaShortItems / alphaItemCount;

    const totalChars = Math.max(1, joined.replace(/\s+/g, '').length);
    const itemsPerChar = Math.min(1, textItems.length / totalChars);

    const tokens = joined.split(/\s+/g).filter((t) => t.length > 0);
    const alphaTokens = tokens.filter((t) => /^[A-Za-z]+$/.test(t));
    const alphaShort = alphaTokens.filter((t) => t.length <= 2).length;
    const alphaLong = alphaTokens.filter((t) => t.length >= 3).length;
    const alphaTotal = Math.max(1, alphaTokens.length);
    const shortRatio = alphaShort / alphaTotal;
    const longRatio = alphaLong / alphaTotal;

    const singleLetterRuns = (joined.match(/(?:\b[A-Za-z]\b\s+){4,}\b[A-Za-z]\b/g) || []).length;
    const mixedFragmentRuns = (joined.match(/\b[A-Za-z]{1,2}(?:\s+[A-Za-z]{1,2}){4,}\b/g) || []).length;

    const penalty = Math.min(
      1,
      singleLetterRuns * 0.25 +
        mixedFragmentRuns * 0.15 +
        alphaShortItemRatio * 0.9 +
        itemsPerChar * 0.75
    );
    const score = longRatio - shortRatio * 0.6 - penalty;
    return Math.max(0, Math.min(1, score));
  }

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

    // Strategy is 'auto' - use combination for best results
    try {
      const pdfiumDoc = await this.pdfiumWrapper.parseDocument(data, options);
      if (options.extractText) {
        const quality = this.scoreTextQuality(pdfiumDoc);
        if (quality < 0.32) {
          try {
            if (!this.unpdfWrapper) this.unpdfWrapper = new UnPDFWrapper();
            const unpdfDoc = await this.unpdfWrapper.parseDocument(data, options);
            const unpdfQuality = this.scoreTextQuality(unpdfDoc);
            
            // Check if we're in semantic mode (preserveLayout + textLayout: 'semantic' OR textLayout: 'flow')
            const isSemanticMode = this.isSemanticModeConfigured();
            
            if (isSemanticMode) {
              // In semantic mode: if pdfium text is garbled, immediately replace all text with unpdf text
              const semanticType = this.getSemanticType();
              console.warn(
                `PDFParser ${semanticType} semantic mode: PDFium text quality low (${quality.toFixed(2)}). Using UnPDF text extraction (${unpdfQuality.toFixed(2)}).`
              );
              
              // Replace all text content with enhanced unpdf text while keeping pdfium's non-text content
              const styler = new EnhancedTextStyler();
              
              for (let i = 0; i < pdfiumDoc.pages.length && i < unpdfDoc.pages.length; i++) {
                const p = pdfiumDoc.pages[i];
                const u = unpdfDoc.pages[i];
                if (!p || !u) continue;
                if (!p.content || !u.content) continue;
                
                const pdfiumText = p.content.text || [];
                const unpdfText = u.content.text || [];
                
                if (unpdfText.length > 0) {
                  // Enhance unpdf text with styling from pdfium text
                  const enhancedText = styler.enhanceUnpdfTextWithStyling(pdfiumText, unpdfText);
                  const contentEnhanced = styler.enhanceContentBasedStyling(enhancedText);
                  p.content.text = contentEnhanced;
                }
              }
              
              return pdfiumDoc;
            } else if (unpdfQuality > quality + 0.08) {
              // Non-semantic mode: use existing logic
              console.warn(
                `PDFParser auto: PDFium text quality low (${quality.toFixed(2)}). Using UnPDF result (${unpdfQuality.toFixed(2)}).`
              );

              for (let i = 0; i < pdfiumDoc.pages.length && i < unpdfDoc.pages.length; i++) {
                const p = pdfiumDoc.pages[i];
                const u = unpdfDoc.pages[i];
                if (!p || !u) continue;
                if (!p.content || !u.content) continue;
                if (Array.isArray(u.content.text) && u.content.text.length > 0) {
                  p.content.text = u.content.text;
                }
              }

              return pdfiumDoc;
            }
          } catch (error) {
            console.warn('PDFParser auto: UnPDF fallback failed after low-quality PDFium text:', error);
          }
        }
      }
      return pdfiumDoc;
    } catch (error) {
      console.warn('PDFium parse failed; falling back to UnPDF:', error);
      if (!this.unpdfWrapper) this.unpdfWrapper = new UnPDFWrapper();
      return await this.unpdfWrapper.parseDocument(data, options);
    }
  }

  /**
   * Get the type of semantic mode being used
   */
  private getSemanticType(): string {
    const g = globalThis as unknown as { 
      __PDF2HTML_CONFIG__?: {
        htmlOptions?: {
          preserveLayout?: boolean;
          textLayout?: string;
        };
      };
    };
    
    const config = g.__PDF2HTML_CONFIG__;
    if (config?.htmlOptions) {
      const { preserveLayout, textLayout } = config.htmlOptions;
      
      // Positioned semantic: preserveLayout + textLayout: 'semantic'
      if (preserveLayout === true && textLayout === 'semantic') {
        return 'positioned';
      }
      
      // Flow semantic: textLayout: 'flow'
      if (textLayout === 'flow') {
        return 'flow';
      }
    }
    
    return 'unknown';
  }

  /**
   * Check if semantic mode is configured in the environment
   * This is a heuristic check since we don't have direct access to the HTML generation config
   */
  private isSemanticModeConfigured(): boolean {
    // Check if semantic mode is indicated via environment variable or global flag
    const g = globalThis as unknown as { 
      __PDF2HTML_SEMANTIC_MODE__?: boolean;
      __PDF2HTML_CONFIG__?: {
        htmlOptions?: {
          preserveLayout?: boolean;
          textLayout?: string;
        };
      };
    };
    
    // Check explicit semantic mode flag
    if (g.__PDF2HTML_SEMANTIC_MODE__ === true) return true;
    
    // Check HTML generation config if available
    const config = g.__PDF2HTML_CONFIG__;
    if (config?.htmlOptions) {
      const { preserveLayout, textLayout } = config.htmlOptions;
      
      // Positioned semantic: preserveLayout + textLayout: 'semantic'
      if (preserveLayout === true && textLayout === 'semantic') {
        return true;
      }
      
      // Flow semantic: textLayout: 'flow'
      if (textLayout === 'flow') {
        return true;
      }
    }
    
    // Check environment variable
    if (typeof process !== 'undefined') {
      const env = (process as unknown as { env?: Record<string, string | undefined> }).env;
      if (env?.PDF2HTML_SEMANTIC_MODE === '1') return true;
    }
    
    return false;
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
