import type { PDFImageContent } from '../types/pdf.js';

export interface PDFJSImageExtractionResult {
  images: PDFImageContent[];
}

type PDFJSViewport = { width: number; height: number };

type PDFJSPage = {
  getOperatorList: () => Promise<PDFJSOperatorList>;
  getViewport: (options: { scale: number }) => PDFJSViewport;
  getResources: () => Promise<PDFJSResources>;
  render?: (options: { canvasContext: CanvasRenderingContext2D; viewport: PDFJSViewport }) => Promise<void>;
};

type PDFJSOperatorList = {
  fnArray: number[];
  argsArray: unknown[];
};

type PDFJSResources = {
  get: (name: string) => Promise<PDFJSXObject | null>;
  getKeys: () => string[];
  keys?: () => IterableIterator<string>;
};

type PDFJSXObject = {
  dict: Record<string, unknown>;
  getData: () => Promise<Uint8Array>;
  width?: number;
  height?: number;
};

export class PDFJSImageExtractor {
  async extractImages(page: PDFJSPage): Promise<PDFJSImageExtractionResult> {
    const images: PDFImageContent[] = [];
    const resourceImages = new Map<string, PDFImageContent>(); // keyed by XObject name

    try {
      const viewport = page.getViewport({ scale: 1.0 });
      // Try to load OPS constants for operator parsing
      let OPS: Record<string, number> | undefined;
      try {
        const pdfjs = await import('pdfjs-dist');
        const moduleMaybe = pdfjs as { OPS?: Record<string, number>; default?: { OPS?: Record<string, number> } };
        OPS = moduleMaybe.OPS || moduleMaybe.default?.OPS;
      } catch (opsError) {
        console.debug('Failed to load pdf.js OPS constants, image placement may be degraded:', opsError);
      }
      
      // Method 1: Extract images from page resources (XObjects)
      try {
        if (page.getResources) {
          const resources = await page.getResources();
          if (resources) {
            // Try to get XObject keys - API may vary
            let xObjectKeys: string[] = [];
            const maybeGetKeys = (resources as { getKeys?: unknown }).getKeys;
            if (typeof resources.getKeys === 'function') {
              xObjectKeys = resources.getKeys();
            } else if (Array.isArray(maybeGetKeys)) {
              xObjectKeys = maybeGetKeys;
            } else if (typeof resources.keys === 'function') {
              xObjectKeys = Array.from(resources.keys());
            }
            
            for (const key of xObjectKeys) {
              try {
                if (typeof resources.get === 'function') {
                  const xObject = await resources.get(key);
                  if (xObject) {
                    const imageContent = await this.extractXObjectImage(xObject, viewport);
                    if (imageContent) {
                      // Store by resource name; multiple placements can reference it via operator list
                      resourceImages.set(key, imageContent);
                    }
                  }
                }
              } catch (error) {
                // Skip invalid XObjects
                console.debug(`Failed to extract XObject ${key}:`, error);
              }
            }
          }
        }
      } catch (resourceError) {
        console.debug('Failed to get page resources, will try fallback method:', resourceError);
      }

      // Method 1b: Use operator list to place XObjects and inline images with their CTM
      try {
        if (OPS && page.getOperatorList) {
          const opList = await page.getOperatorList();
          const { fnArray, argsArray } = opList;

          const multiply = (m1: number[], m2: number[]): number[] => {
            const [a1, b1, c1, d1, e1, f1] = m1;
            const [a2, b2, c2, d2, e2, f2] = m2;
            return [
              a1 * a2 + c1 * b2,
              b1 * a2 + d1 * b2,
              a1 * c2 + c1 * d2,
              b1 * c2 + d1 * d2,
              a1 * e2 + c1 * f2 + e1,
              b1 * e2 + d1 * f2 + f1
            ];
          };

          const current: { ctm: number[]; stack: number[][] } = {
            ctm: [1, 0, 0, 1, 0, 0],
            stack: []
          };

          const placeImage = (base: PDFImageContent): void => {
            const [a, b, c, d, e, f] = current.ctm;
            const scaleX = Math.hypot(a, b) || 1;
            const scaleY = Math.hypot(c, d) || 1;
            images.push({
              ...base,
              x: e,
              y: f,
              width: base.width * scaleX,
              height: base.height * scaleY
            });
          };

          for (let i = 0; i < fnArray.length; i++) {
            const fn = fnArray[i];
            const args = argsArray[i] as unknown[];

            switch (fn) {
              case OPS.save:
                current.stack.push([...current.ctm]);
                break;
              case OPS.restore:
                current.ctm = current.stack.pop() || [1, 0, 0, 1, 0, 0];
                break;
              case OPS.transform: {
                const [a, b, c, d, e, f] = (args || []) as number[];
                if ([a, b, c, d, e, f].every((n) => typeof n === 'number')) {
                  current.ctm = multiply(current.ctm, [a, b, c, d, e, f]);
                }
                break;
              }
              case OPS.paintImageXObject: {
                const name = args?.[0] as string | undefined;
                if (name && resourceImages.has(name)) {
                  placeImage(resourceImages.get(name)!);
                }
                break;
              }
              case OPS.paintImageXObjectRepeat: {
                const name = args?.[0] as string | undefined;
                if (name && resourceImages.has(name)) {
                  placeImage(resourceImages.get(name)!);
                }
                break;
              }
              case OPS.paintInlineImageXObject: {
                const inline = args?.[0] as { data?: Uint8Array; width?: number; height?: number } | undefined;
                if (inline?.data && inline.width && inline.height) {
                  const base64Data = this.convertImageDataToBase64(inline.data, 'png');
                  const base: PDFImageContent = {
                    data: base64Data,
                    format: 'png',
                    x: 0,
                    y: 0,
                    width: inline.width,
                    height: inline.height
                  };
                  placeImage(base);
                }
                break;
              }
              default:
                break;
            }
          }
        }
      } catch (opsError) {
        console.debug('Failed to place images via operator list:', opsError);
      }

      // Method 2: Fallback - render page to canvas and extract as single image
      // This is used when individual images can't be extracted
      if (images.length === 0 && page.render) {
        try {
          const canvas = typeof document !== 'undefined' 
            ? document.createElement('canvas')
            : null;
          
          if (canvas) {
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              await page.render({
                canvasContext: ctx,
                viewport: viewport
              });
              
              // Convert canvas to image
              const imageData = canvas.toDataURL('image/png');
              images.push({
                data: imageData,
                format: 'png',
                x: 0,
                y: 0,
                width: viewport.width,
                height: viewport.height
              });
            }
          }
        } catch (renderError) {
          console.debug('Failed to render page as image:', renderError);
        }
      }
    } catch (error) {
      console.warn('Failed to extract images from page:', error);
    }

    return {
      images
    };
  }

  private async extractXObjectImage(
    xObject: PDFJSXObject,
    viewport: { width: number; height: number }
  ): Promise<PDFImageContent | null> {
    try {
      // Check if this is an image XObject
      const dict = xObject.dict || {};
      const subtypeRaw = (dict as { Subtype?: unknown }).Subtype 
        || (typeof (dict as { get?: (key: string) => unknown }).get === 'function'
          ? (dict as { get: (key: string) => unknown }).get('Subtype')
          : undefined);
      const subtype = typeof subtypeRaw === 'string'
        ? subtypeRaw
        : (typeof subtypeRaw === 'object' && subtypeRaw && 'name' in subtypeRaw
            ? (subtypeRaw as { name?: string }).name
            : subtypeRaw);
      
      // Image XObjects have Subtype = 'Image'
      if (subtype !== 'Image') {
        return null;
      }

      // Get image data
      const imageData = await xObject.getData();
      if (!imageData || imageData.length === 0) {
        return null;
      }

      // Get dimensions
      const width = (xObject.width 
        || (dict as { Width?: unknown }).Width 
        || (typeof (dict as { get?: (key: string) => unknown }).get === 'function'
          ? (dict as { get: (key: string) => unknown }).get('Width')
          : undefined)
        || viewport.width) as number;
      const height = (xObject.height 
        || (dict as { Height?: unknown }).Height 
        || (typeof (dict as { get?: (key: string) => unknown }).get === 'function'
          ? (dict as { get: (key: string) => unknown }).get('Height')
          : undefined)
        || viewport.height) as number;

      // Determine image format from Filter
      const filter = (dict as { Filter?: unknown }).Filter 
        || (typeof (dict as { get?: (key: string) => unknown }).get === 'function'
          ? (dict as { get: (key: string) => unknown }).get('Filter')
          : undefined);
      let format = 'jpeg'; // Default

      const resolveFilterName = (value: unknown): string | undefined => {
        if (typeof value === 'string') return value;
        if (value && typeof value === 'object' && 'name' in value) {
          return (value as { name?: string }).name;
        }
        return undefined;
      };

      if (Array.isArray(filter)) {
        const filterName = resolveFilterName(filter[0]);
        if (filterName) {
          if (filterName.includes('DCTDecode') || filterName === 'DCT') {
            format = 'jpeg';
          } else if (filterName.includes('FlateDecode') || filterName === 'Fl') {
            format = 'png';
          } else if (filterName.includes('JPXDecode')) {
            format = 'jpeg';
          }
        }
      } else if (filter) {
        const filterName = resolveFilterName(filter);
        if (filterName) {
          if (filterName.includes('DCTDecode') || filterName === 'DCT') {
            format = 'jpeg';
          } else if (filterName.includes('FlateDecode') || filterName === 'Fl') {
            format = 'png';
          } else if (filterName.includes('JPXDecode')) {
            format = 'jpeg';
          }
        }
      }

      const base64Data = this.convertImageDataToBase64(imageData, format);

      // Get position from transformation matrix if available
      // For now, we'll place images at (0, 0) - this could be improved
      // by tracking the current transformation matrix from operators
      const x = 0;
      const y = 0;

      return {
        data: base64Data,
        format: format as 'jpeg' | 'png' | 'gif' | 'webp',
        x,
        y,
        width,
        height
      };
    } catch (error) {
      console.debug('Failed to extract XObject image:', error);
      return null;
    }
  }

  private convertImageDataToBase64(data: Uint8Array, format: string): string {
    // Convert Uint8Array to base64
    let base64: string;
    if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(data).toString('base64');
    } else {
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      base64 = btoa(binary);
    }
    return `data:image/${format};base64,${base64}`;
  }

  // Available for future use when image data is extracted
  // @ts-expect-error - Intentionally unused, available for future image extraction
  private convertImageFormat(_data: ArrayBuffer, _format: string): string {
    const data = _data;
    const format = _format;
    // Convert ArrayBuffer to base64 data URL
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:image/${format};base64,${base64}`;
  }
}
