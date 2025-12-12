import type { PDFDocument } from '../types/pdf.js';

export interface ScannedPDFAnalysis {
  isScanned: boolean;
  confidence: number;
  textContentRatio: number;
  imageContentRatio: number;
  totalTextLength: number;
  totalImageCount: number;
  pagesWithText: number;
  pagesWithImages: number;
}

/**
 * Detects if a PDF is a scanned document (image-based with little to no text)
 * Scanned PDFs typically have:
 * - Many images (often one per page covering most of the page)
 * - Little to no extractable text
 * - Images that cover a significant portion of the page area
 */
export class ScannedPDFDetector {
  /**
   * Analyzes a PDF document to determine if it's a scanned PDF
   * @param document The parsed PDF document
   * @returns Analysis result with confidence score
   */
  analyze(document: PDFDocument): ScannedPDFAnalysis {
    let totalTextLength = 0;
    let totalImageCount = 0;
    let pagesWithText = 0;
    let pagesWithImages = 0;
    let totalPageArea = 0;
    let totalImageArea = 0;

    for (const page of document.pages) {
      const pageArea = page.width * page.height;
      totalPageArea += pageArea;

      // Count text content
      const pageTextLength = page.content.text.reduce((sum, textItem) => {
        return sum + (textItem.text?.length || 0);
      }, 0);
      
      totalTextLength += pageTextLength;
      if (pageTextLength > 0) {
        pagesWithText++;
      }

      // Count images and calculate image coverage
      const pageImageCount = page.content.images.length;
      totalImageCount += pageImageCount;
      
      if (pageImageCount > 0) {
        pagesWithImages++;
        
        // Calculate total image area on this page
        const pageImageArea = page.content.images.reduce((sum, img) => {
          return sum + (img.width * img.height);
        }, 0);
        
        totalImageArea += pageImageArea;
      }
    }

    // Calculate ratios
    const avgTextPerPage = totalTextLength / document.pageCount;
    const avgImagesPerPage = totalImageCount / document.pageCount;
    const imageCoverageRatio = totalPageArea > 0 ? totalImageArea / totalPageArea : 0;
    const textContentRatio = avgTextPerPage / 1000; // Normalize (1000 chars = 1.0)
    const imageContentRatio = avgImagesPerPage;

    // Determine if scanned based on heuristics
    const isScanned = this.determineIfScanned({
      avgTextPerPage,
      avgImagesPerPage,
      imageCoverageRatio,
      pagesWithText,
      pagesWithImages,
      totalPages: document.pageCount
    });

    // Calculate confidence score (0-1)
    const confidence = this.calculateConfidence({
      avgTextPerPage,
      avgImagesPerPage,
      imageCoverageRatio,
      pagesWithText,
      pagesWithImages,
      totalPages: document.pageCount,
      isScanned
    });

    return {
      isScanned,
      confidence,
      textContentRatio,
      imageContentRatio,
      totalTextLength,
      totalImageCount,
      pagesWithText,
      pagesWithImages
    };
  }

  private determineIfScanned(params: {
    avgTextPerPage: number;
    avgImagesPerPage: number;
    imageCoverageRatio: number;
    pagesWithText: number;
    pagesWithImages: number;
    totalPages: number;
  }): boolean {
    const {
      avgTextPerPage,
      avgImagesPerPage,
      imageCoverageRatio,
      pagesWithText,
      pagesWithImages,
      totalPages
    } = params;

    // Strong indicators of scanned PDF:
    // 1. Very little text (< 50 chars per page on average)
    // 2. Many images (>= 1 per page on average)
    // 3. High image coverage (> 30% of page area)
    // 4. Most pages have images but no text

    const hasLittleText = avgTextPerPage < 50;
    const hasManyImages = avgImagesPerPage >= 0.8; // At least 0.8 images per page
    const hasHighImageCoverage = imageCoverageRatio > 0.3;
    const mostPagesHaveImages = pagesWithImages / totalPages > 0.7;
    const fewPagesHaveText = pagesWithText / totalPages < 0.3;

    // Scanned PDF if:
    // - Has little text AND (has many images OR high image coverage)
    // - OR most pages have images but few have text
    if (hasLittleText && (hasManyImages || hasHighImageCoverage)) {
      return true;
    }

    if (mostPagesHaveImages && fewPagesHaveText && hasManyImages) {
      return true;
    }

    return false;
  }

  private calculateConfidence(params: {
    avgTextPerPage: number;
    avgImagesPerPage: number;
    imageCoverageRatio: number;
    pagesWithText: number;
    pagesWithImages: number;
    totalPages: number;
    isScanned: boolean;
  }): number {
    const {
      avgTextPerPage,
      avgImagesPerPage,
      imageCoverageRatio,
      pagesWithText,
      pagesWithImages,
      totalPages,
      isScanned
    } = params;

    if (!isScanned) {
      // High confidence it's NOT scanned if there's substantial text
      if (avgTextPerPage > 200) {
        return 0.9;
      }
      return 0.5; // Medium confidence
    }

    // Calculate confidence for scanned PDF
    let confidence = 0.5; // Base confidence

    // Increase confidence based on indicators
    if (avgTextPerPage < 20) {
      confidence += 0.2; // Very little text
    }
    if (avgImagesPerPage >= 1.0) {
      confidence += 0.2; // At least one image per page
    }
    if (imageCoverageRatio > 0.5) {
      confidence += 0.15; // Images cover > 50% of page area
    }
    if (pagesWithImages / totalPages > 0.9 && pagesWithText / totalPages < 0.2) {
      confidence += 0.15; // 90%+ pages have images, < 20% have text
    }

    return Math.min(confidence, 1.0);
  }
}

