/**
 * Enhanced Text Styler
 * 
 * Provides enhanced styling detection and preservation for unpdf text extraction
 * by mapping positional information between pdfium and unpdf text items
 */

import type { PDFTextContent } from '../types/pdf.js';

export interface StyleMapping {
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  textDecoration: 'none' | 'underline' | 'line-through' | 'overline';
  confidence: number;
}

export interface TextStyleCluster {
  items: PDFTextContent[];
  style: StyleMapping;
  bounds: { x: number; y: number; width: number; height: number };
}

export class EnhancedTextStyler {
  private readonly POSITION_TOLERANCE = 5; // pixels
  private readonly MIN_CLUSTER_SIZE = 2;

  /**
   * Enhance unpdf text items with styling information from pdfium text items
   */
  enhanceUnpdfTextWithStyling(
    pdfiumText: PDFTextContent[],
    unpdfText: PDFTextContent[]
  ): PDFTextContent[] {
    if (!pdfiumText.length || !unpdfText.length) {
      return unpdfText;
    }

    // Create style clusters from pdfium text
    const styleClusters = this.createStyleClusters(pdfiumText);
    
    // Map unpdf text items to style clusters
    const enhancedUnpdfText = unpdfText.map(unpdfItem => {
      const mappedStyle = this.findBestStyleMatch(unpdfItem, styleClusters);
      return this.applyStyleToTextItem(unpdfItem, mappedStyle);
    });

    return enhancedUnpdfText;
  }

  /**
   * Create style clusters from pdfium text items
   */
  private createStyleClusters(textItems: PDFTextContent[]): TextStyleCluster[] {
    const clusters: TextStyleCluster[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < textItems.length; i++) {
      if (processed.has(i)) continue;

      const seedItem = textItems[i];
      const cluster = this.growCluster(seedItem, textItems, processed);
      
      if (cluster.items.length >= this.MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Grow a cluster of text items with similar styling
   */
  private growCluster(
    seed: PDFTextContent,
    allItems: PDFTextContent[],
    processed: Set<number>
  ): TextStyleCluster {
    const cluster: TextStyleCluster = {
      items: [seed],
      style: this.extractStyle(seed),
      bounds: {
        x: seed.x,
        y: seed.y,
        width: seed.width,
        height: seed.height
      }
    };

    processed.add(allItems.indexOf(seed));

    // Find similar items
    for (let i = 0; i < allItems.length; i++) {
      if (processed.has(i)) continue;

      const item = allItems[i];
      if (this.hasSimilarStyle(seed, item) && this.isPositionallyClose(cluster, item)) {
        cluster.items.push(item);
        cluster.bounds = this.expandBounds(cluster.bounds, item);
        processed.add(i);
      }
    }

    return cluster;
  }

  /**
   * Check if two text items have similar styling
   */
  private hasSimilarStyle(item1: PDFTextContent, item2: PDFTextContent): boolean {
    // Font weight similarity (allow some variance)
    const weightDiff = Math.abs((item1.fontWeight || 400) - (item2.fontWeight || 400));
    if (weightDiff > 100) return false;

    // Font style match
    if (item1.fontStyle !== item2.fontStyle) return false;

    // Text decoration match
    const decoration1 = item1.textDecoration || 'none';
    const decoration2 = item2.textDecoration || 'none';
    if (decoration1 !== decoration2) return false;

    return true;
  }

  /**
   * Check if an item is positionally close to a cluster
   */
  private isPositionallyClose(cluster: TextStyleCluster, item: PDFTextContent): boolean {
    const clusterCenterX = cluster.bounds.x + cluster.bounds.width / 2;
    const clusterCenterY = cluster.bounds.y + cluster.bounds.height / 2;
    const itemCenterX = item.x + item.width / 2;
    const itemCenterY = item.y + item.height / 2;

    const distance = Math.sqrt(
      Math.pow(clusterCenterX - itemCenterX, 2) + 
      Math.pow(clusterCenterY - itemCenterY, 2)
    );

    return distance <= this.POSITION_TOLERANCE * 3;
  }

  /**
   * Find the best style match for an unpdf text item
   */
  private findBestStyleMatch(
    unpdfItem: PDFTextContent,
    styleClusters: TextStyleCluster[]
  ): StyleMapping | null {
    let bestMatch: StyleMapping | null = null;
    let bestScore = 0;

    for (const cluster of styleClusters) {
      const score = this.calculateStyleMatchScore(unpdfItem, cluster);
      if (score > bestScore && score > 0.5) { // Minimum confidence threshold
        bestScore = score;
        bestMatch = cluster.style;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate style match score between unpdf item and style cluster
   */
  private calculateStyleMatchScore(
    unpdfItem: PDFTextContent,
    cluster: TextStyleCluster
  ): number {
    let score = 0;
    let factors = 0;

    // Positional proximity (most important)
    const clusterCenterX = cluster.bounds.x + cluster.bounds.width / 2;
    const clusterCenterY = cluster.bounds.y + cluster.bounds.height / 2;
    const itemCenterX = unpdfItem.x + unpdfItem.width / 2;
    const itemCenterY = unpdfItem.y + unpdfItem.height / 2;
    
    const distance = Math.sqrt(
      Math.pow(clusterCenterX - itemCenterX, 2) + 
      Math.pow(clusterCenterY - itemCenterY, 2)
    );
    
    const positionScore = Math.max(0, 1 - distance / (this.POSITION_TOLERANCE * 5));
    score += positionScore * 0.8; // 80% weight for position
    factors += 0.8;

    // Text length similarity (indicates similar content type)
    const avgClusterTextLength = cluster.items.reduce((sum, item) => sum + (item.text?.length || 0), 0) / cluster.items.length;
    const lengthDiff = Math.abs((unpdfItem.text?.length || 0) - avgClusterTextLength) / Math.max(avgClusterTextLength, 1);
    const lengthScore = Math.max(0, 1 - lengthDiff);
    score += lengthScore * 0.2; // 20% weight for text length
    factors += 0.2;

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Apply detected style to a text item
   */
  private applyStyleToTextItem(
    item: PDFTextContent,
    style: StyleMapping | null
  ): PDFTextContent {
    if (!style) return item;

    return {
      ...item,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textDecoration: style.textDecoration
    };
  }

  /**
   * Extract style information from a text item
   */
  private extractStyle(item: PDFTextContent): StyleMapping {
    return {
      fontWeight: item.fontWeight || 400,
      fontStyle: item.fontStyle || 'normal',
      textDecoration: item.textDecoration || 'none',
      confidence: 1.0
    };
  }

  /**
   * Expand bounds to include a new item
   */
  private expandBounds(
    current: { x: number; y: number; width: number; height: number },
    item: PDFTextContent
  ): { x: number; y: number; width: number; height: number } {
    const minX = Math.min(current.x, item.x);
    const minY = Math.min(current.y, item.y);
    const maxX = Math.max(current.x + current.width, item.x + item.width);
    const maxY = Math.max(current.y + current.height, item.y + item.height);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Detect and enhance text styling based on content patterns
   */
  enhanceContentBasedStyling(textItems: PDFTextContent[]): PDFTextContent[] {
    return textItems.map(item => {
      const enhanced = { ...item };
      const text = (item.text || '').trim();

      // Detect headings (bold)
      if (this.isLikelyHeading(text)) {
        enhanced.fontWeight = Math.max(enhanced.fontWeight || 400, 700);
      }

      // Detect emphasis (bold/italic)
      if (this.isLikelyEmphasis(text)) {
        enhanced.fontWeight = Math.max(enhanced.fontWeight || 400, 600);
        enhanced.fontStyle = 'italic';
      }

      // Detect code (monospace - keep as is since we only handle basic formatting)
      // Code styling would be handled by font-family, which we're not extracting

      return enhanced;
    });
  }

  /**
   * Check if text is likely a heading
   */
  private isLikelyHeading(text: string): boolean {
    // Short text that might be a heading
    if (text.length > 50) return false;
    if (text.length === 0) return false;
    
    // Title case or all caps
    const isTitleCase = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(text);
    const isAllCaps = text === text.toUpperCase() && /[A-Z]/.test(text);
    
    return isTitleCase || isAllCaps;
  }

  /**
   * Check if text is likely emphasized
   */
  private isLikelyEmphasis(text: string): boolean {
    // Short phrases that might be emphasized
    return text.length <= 20 && text.length >= 2 && /^[A-Za-z\s]+$/.test(text);
  }
}
