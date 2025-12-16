import type {
  OCRPageResult,
  OCRProcessorOptions,
  OCRResult
} from '../types/ocr.js';
import type { PDFPage, PDFImageContent } from '../types/pdf.js';
import { OCREngine } from './ocr-engine.js';

export class OCRProcessor {
  private engine: OCREngine;
  private options: OCRProcessorOptions;

  constructor(
    engine: OCREngine,
    options: OCRProcessorOptions = {}
  ) {
    this.engine = engine;
    this.options = {
      batchSize: 1,
      maxConcurrent: 2,
      timeout: 30000,
      ...options
    };
  }

  async processPage(
    page: PDFPage,
    pageNumber: number
  ): Promise<OCRPageResult> {
    const startTime = Date.now();

    if (page.content.images.length === 0) {
      return {
        pageNumber,
        results: [],
        processingTime: 0
      };
    }

    const results: OCRResult[] = [];

    for (const image of page.content.images) {
      const imageData = await this.convertImageToImageData(image);
      const ocrResults = await this.engine.recognize(imageData);
      results.push(...ocrResults);
    }

    return {
      pageNumber,
      results,
      processingTime: Date.now() - startTime
    };
  }

  async processPages(
    pages: PDFPage[]
  ): Promise<OCRPageResult[]> {
    const results: OCRPageResult[] = [];

    if (this.options.maxConcurrent && this.options.maxConcurrent > 1) {
      results.push(...(await this.processPagesParallel(pages)));
    } else {
      for (let i = 0; i < pages.length; i++) {
        const result = await this.processPage(pages[i], i);
        results.push(result);
      }
    }

    return results;
  }

  private async processPagesParallel(
    pages: PDFPage[]
  ): Promise<OCRPageResult[]> {
    const results: OCRPageResult[] = [];
    const queue: Promise<void>[] = [];
    const maxConcurrent = this.options.maxConcurrent || 2;

    for (let i = 0; i < pages.length; i++) {
      const promise = this.processPage(pages[i], i).then((result) => {
        results[i] = result;
      });

      queue.push(promise);

      if (queue.length >= maxConcurrent) {
        await Promise.race(queue);
        queue.splice(
          queue.findIndex((p) => p === promise),
          1
        );
      }
    }

    await Promise.all(queue);
    return results;
  }

  private async convertImageToImageData(
    image: PDFImageContent
  ): Promise<ImageData> {
    const { ImageConverter } = await import('../utils/image-converter.js');
    return ImageConverter.convertToImageData(image);
  }

  // @ts-expect-error - Unused private method
  private async renderPageToImage(
    page: PDFPage
  ): Promise<ImageData> {
    // For scanned PDFs, we need to render the entire page as an image
    // This would typically be done by the PDF parser rendering the page
    // For now, we'll combine all images on the page or use a canvas
    
    if (page.content.images.length > 0) {
      // Use the first/largest image, or combine them
      return await this.convertImageToImageData(page.content.images[0]);
    }

    // If no images, create a blank image data
    const canvas = document.createElement('canvas');
    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
}

