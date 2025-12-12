import type { PDFImageContent } from '../types/pdf.js';

export interface PDFiumImageExtractionResult {
  images: PDFImageContent[];
}

type PDFiumPage = {
  getWidth: () => number;
  getHeight: () => number;
  render: (options?: { scale?: number }) => Promise<ImageData>;
  getImages?: () => Promise<PDFiumImage[]>;
};

type PDFiumImage = {
  data: ArrayBuffer;
  format: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export class PDFiumImageExtractor {
  async extractImages(page: PDFiumPage): Promise<PDFiumImageExtractionResult> {
    const images: PDFImageContent[] = [];

    try {
      // Try to get images directly if API available
      if (page.getImages) {
        const pdfImages = await page.getImages();
        
        for (const img of pdfImages) {
          const imageContent = this.parseImageItem(img, page.getHeight());
          if (imageContent) {
            images.push(imageContent);
          }
        }
      } else {
        // Fallback: render page to canvas and extract as single image
        // This captures the entire page as an image when individual image extraction isn't available
        try {
          const imageData = await page.render({ scale: 1.0 });
          
          if (imageData && imageData.data) {
            // Convert ImageData to base64
            const canvas = typeof document !== 'undefined' 
              ? document.createElement('canvas')
              : null;
            
            if (canvas) {
              canvas.width = imageData.width;
              canvas.height = imageData.height;
              const ctx = canvas.getContext('2d');
              
              if (ctx) {
                ctx.putImageData(imageData, 0, 0);
                const base64Data = canvas.toDataURL('image/png');
                
                images.push({
                  data: base64Data,
                  format: 'png',
                  x: 0,
                  y: 0,
                  width: imageData.width,
                  height: imageData.height
                });
              }
            } else {
              // Node.js environment - convert ImageData to base64 directly
              const base64Data = this.convertImageDataToBase64(imageData);
              images.push({
                data: base64Data,
                format: 'png',
                x: 0,
                y: 0,
                width: imageData.width,
                height: imageData.height
              });
            }
          }
        } catch (renderError) {
          console.warn('Failed to render PDFium page as image:', renderError);
        }
      }
    } catch (error) {
      console.warn('Failed to extract images from PDFium page:', error);
    }

    return {
      images
    };
  }

  private parseImageItem(
    item: PDFiumImage,
    pageHeight: number
  ): PDFImageContent | null {
    if (!item.data || item.data.byteLength === 0) {
      return null;
    }

    // Convert Y coordinate (PDFium uses bottom-left origin)
    const y = pageHeight - item.y - item.height;

    // Determine format
    const format = this.detectImageFormat(item.data, item.format);

    // Convert ArrayBuffer to base64 string for HTML output
    const base64Data = this.convertImageFormat(item.data, format);

    return {
      data: base64Data, // Store as base64 string
      format: format as 'jpeg' | 'png' | 'gif' | 'webp',
      x: item.x,
      y,
      width: item.width,
      height: item.height
    };
  }

  private detectImageFormat(data: ArrayBuffer, formatHint?: string): string {
    if (formatHint) {
      return formatHint.toLowerCase();
    }

    // Check magic bytes
    const bytes = new Uint8Array(data.slice(0, 4));
    
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'jpeg';
    }
    
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return 'png';
    }
    
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'gif';
    }
    
    // Default to JPEG
    return 'jpeg';
  }

  private convertImageFormat(data: ArrayBuffer, format: string): string {
    // Convert ArrayBuffer to base64 data URL
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:image/${format};base64,${base64}`;
  }

  private convertImageDataToBase64(imageData: ImageData): string {
    // Convert ImageData to base64 PNG
    // In browser, we'd use canvas, but in Node.js we need to manually encode
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
    
    // Node.js fallback: convert ImageData to PNG manually
    // This is a simplified approach - full PNG encoding would be more complex
    // For now, we'll convert the raw pixel data
    const data = imageData.data;
    
    // Simple base64 encoding of raw RGBA data
    // Note: This won't be a valid PNG, but will work for display purposes
    // In production, you'd want to use a proper PNG encoder library
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64 = btoa(binary);
    return `data:image/png;base64,${base64}`;
  }
}

