import type { PDFImageContent } from '../types/pdf.js';

export interface PDFiumImageExtractionResult {
  images: PDFImageContent[];
}

type PDFiumPage = {
  getWidth?: () => number;
  getHeight?: () => number;
  render?: (options?: { scale?: number; render?: unknown }) => Promise<unknown>;
  getImages?: () => Promise<PDFiumImage[]>;
  objects?: () => IterableIterator<unknown>;
};

type PDFiumImageDataRaw = {
  data: Uint8Array;
  width: number;
  height: number;
  filters?: string[];
};

type PDFiumPageObject = {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rect?: number[];
  render?: (options: { render?: 'bitmap' | ((options: unknown) => Promise<Uint8Array>) }) => Promise<unknown>;
  getImageDataRaw?: () => PDFiumImageDataRaw;
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
  constructor(private enableFullPageRasterFallback: boolean = false) {}

  async extractImages(page: PDFiumPage): Promise<PDFiumImageExtractionResult> {
    const images: PDFImageContent[] = [];

    try {
      const pageHeight = typeof page.getHeight === 'function' ? page.getHeight() : 0;

      if (typeof page.objects === 'function') {
        for (const obj of page.objects()) {
          const o = obj as PDFiumPageObject;
          if (o?.type !== 'image') {
            continue;
          }

          const raw = typeof o.getImageDataRaw === 'function' ? o.getImageDataRaw() : null;
          let rendered: unknown = null;
          try {
            if (typeof o.render === 'function') {
              rendered = await o.render({ render: 'bitmap' });
            }
          } catch {
            rendered = null;
          }

          const dataUrl = rendered ? this.renderedToDataUrl(rendered) : null;
          if (!dataUrl && !raw) {
            continue;
          }

          let x = 0;
          let y = 0;
          let w = 0;
          let h = 0;
          if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.width === 'number' && typeof o.height === 'number') {
            x = o.x;
            y = pageHeight ? pageHeight - o.y - o.height : o.y;
            w = o.width;
            h = o.height;
          } else if (Array.isArray(o.rect) && o.rect.length >= 4) {
            const [x1, y1, x2, y2] = o.rect;
            x = x1;
            y = pageHeight ? pageHeight - y2 : y1;
            w = x2 - x1;
            h = y2 - y1;
          } else if (raw) {
            w = raw.width;
            h = raw.height;
          } else {
            const r = rendered as { width?: unknown; height?: unknown };
            if (typeof r.width === 'number') w = r.width;
            if (typeof r.height === 'number') h = r.height;
          }

          images.push({
            data: dataUrl || this.rawToFallbackDataUrl(raw!),
            format: 'png',
            x,
            y,
            width: w,
            height: h
          });

          if (images.length >= 50) break;
        }
      }

      // Try to get images directly if API available
      if (images.length === 0 && page.getImages) {
        const pdfImages = await page.getImages();
        
        for (const img of pdfImages) {
          const imageContent = this.parseImageItem(img, pageHeight);
          if (imageContent) {
            images.push(imageContent);
          }
        }
      } else if (this.enableFullPageRasterFallback) {
        // Fallback: render page to canvas and extract as single image
        // This captures the entire page as an image when individual image extraction isn't available
        try {
          const rendered = await page.render?.({ scale: 1.0, render: 'bitmap' });
          if (rendered) {
            const base64Data = this.renderedToDataUrl(rendered);
            if (base64Data) {
              const r = rendered as { width?: unknown; height?: unknown };
              const w = typeof r.width === 'number' ? r.width : page.getWidth?.() || 0;
              const h = typeof r.height === 'number' ? r.height : page.getHeight?.() || 0;
              images.push({
                data: base64Data,
                format: 'png',
                x: 0,
                y: 0,
                width: w,
                height: h
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

  private renderedToDataUrl(rendered: unknown): string | null {
    const asImageData = rendered as ImageData;
    if (
      asImageData &&
      typeof asImageData.width === 'number' &&
      typeof asImageData.height === 'number' &&
      asImageData.data instanceof Uint8ClampedArray
    ) {
      return this.rgbaToPngDataUrl(asImageData.data, asImageData.width, asImageData.height);
    }

    const asBitmap = rendered as { data?: unknown; width?: unknown; height?: unknown };
    if (asBitmap?.data instanceof Uint8Array && typeof asBitmap.width === 'number' && typeof asBitmap.height === 'number') {
      return this.rgbaToPngDataUrl(asBitmap.data, asBitmap.width, asBitmap.height);
    }

    const nested = rendered as { data?: unknown };
    const inner = nested?.data as { data?: unknown; width?: unknown; height?: unknown } | undefined;
    if (inner?.data instanceof Uint8Array && typeof inner.width === 'number' && typeof inner.height === 'number') {
      return this.rgbaToPngDataUrl(inner.data, inner.width, inner.height);
    }

    return null;
  }

  private rgbaToPngDataUrl(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): string {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const clamped = rgba instanceof Uint8ClampedArray
          ? Uint8ClampedArray.from(rgba)
          : Uint8ClampedArray.from(rgba);
        const img = new ImageData(clamped, width, height);
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL('image/png');
      }
    }

    let binary = '';
    const u8 = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    for (let i = 0; i < u8.length; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    const base64 = typeof Buffer !== 'undefined' ? Buffer.from(binary, 'binary').toString('base64') : btoa(binary);
    return `data:image/png;base64,${base64}`;
  }

  private rawToFallbackDataUrl(raw: PDFiumImageDataRaw): string {
    return this.rgbaToPngDataUrl(raw.data, raw.width, raw.height);
  }
}

