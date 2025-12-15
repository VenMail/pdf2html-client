import type { PDFImageContent } from '../types/pdf.js';

export interface PDFJSImageExtractionResult {
  images: PDFImageContent[];
}

type PDFJSViewport = { width: number; height: number } & Record<string, unknown>;

type PDFJSPage = {
  getOperatorList: () => Promise<PDFJSOperatorList>;
  getViewport: (options: { scale: number }) => PDFJSViewport;
  getResources: () => Promise<PDFJSResources>;
  render?: (options: { canvasContext: CanvasRenderingContext2D; viewport: PDFJSViewport }) => unknown;
};

type PDFJSPageWithObjs = PDFJSPage & {
  objs?: {
    get?: (...args: unknown[]) => unknown;
    has?: (name: string) => boolean;
  };
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
  constructor(private enableFullPageRasterFallback: boolean = false) {}

  async extractImages(page: PDFJSPage): Promise<PDFJSImageExtractionResult> {
    const images: PDFImageContent[] = [];
    const resourceImages = new Map<string, PDFImageContent>(); // keyed by XObject name
    // Access pdf.js internal object store when available (used by operator list)
    const objectStore = (page as PDFJSPageWithObjs).objs;

    try {
      const viewport = page.getViewport({ scale: 1.0 });
      // Try to load OPS constants for operator parsing using unpdf
      let OPS: Record<string, number> | undefined;
      try {
        const imported = await import('pdfjs-dist');
        const pdfjs = (imported as unknown as { OPS?: Record<string, number>; default?: { OPS?: Record<string, number> } });
        OPS = pdfjs.OPS || pdfjs.default?.OPS;
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
                  const maybeXObject = resources.get(key);
                  const xObject = maybeXObject instanceof Promise ? await maybeXObject : maybeXObject;
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

          const resolveObj = async (name: string): Promise<unknown> => {
            if (!objectStore?.get) return undefined;
            try {
              const getFn = objectStore.get as (...args: unknown[]) => unknown;
              return await new Promise((resolve) => {
                let settled = false;
                const finish = (value: unknown): void => {
                  if (settled) return;
                  settled = true;
                  resolve(value);
                };

                // Prefer callback-based API when available. In pdf.js, PDFObjects.get accepts an
                // optional callback even when get.length === 1.
                try {
                  const maybe = getFn(name, (value: unknown) => finish(value));
                  if (maybe !== undefined) {
                    finish(maybe);
                  }
                  return;
                } catch {
                  // ignore and fall back
                }

                try {
                  finish(getFn(name));
                } catch {
                  finish(undefined);
                }
              });
            } catch {
              return undefined;
            }
          };

          const rgbaToPngDataUrl = (rgba: Uint8Array, width: number, height: number): string | null => {
            try {
              if (typeof document === 'undefined') return null;
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return null;
              // Ensure the backing buffer is a real ArrayBuffer to satisfy TS DOM types (avoid SharedArrayBuffer issues).
              const clamped = rgba instanceof Uint8ClampedArray
                ? Uint8ClampedArray.from(rgba)
                : Uint8ClampedArray.from(rgba);
              const img = new ImageData(clamped, width, height);
              ctx.putImageData(img, 0, 0);
              return canvas.toDataURL('image/png');
            } catch {
              return null;
            }
          };

          const resolveImageFromObjs = async (name: string): Promise<PDFImageContent | null> => {
            const resolved = await resolveObj(name);
            if (!resolved || typeof resolved !== 'object') return null;

            const maybe = resolved as {
              data?: Uint8Array;
              width?: number;
              height?: number;
            };
            if (!maybe.data || !maybe.width || !maybe.height) return null;

            const dataUrl = rgbaToPngDataUrl(maybe.data, maybe.width, maybe.height);
            if (!dataUrl) return null;
            return {
              data: dataUrl,
              format: 'png',
              x: 0,
              y: 0,
              width: maybe.width,
              height: maybe.height
            };
          };

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
              width: scaleX,
              height: scaleY
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
                if (name) {
                  if (resourceImages.has(name)) {
                    placeImage(resourceImages.get(name)!);
                  } else {
                    const extracted = await resolveImageFromObjs(name);
                    if (extracted) placeImage(extracted);
                  }
                }
                break;
              }
              case OPS.paintImageXObjectRepeat: {
                const name = args?.[0] as string | undefined;
                if (name) {
                  if (resourceImages.has(name)) {
                    placeImage(resourceImages.get(name)!);
                  } else {
                    const extracted = await resolveImageFromObjs(name);
                    if (extracted) placeImage(extracted);
                  }
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
      // Important: if we already discovered XObject images (resourceImages) but failed to place them,
      // do NOT inject a full-page raster here ("giant image"). That would mask placement bugs and
      // makes the HTML output harder to debug.
      if (this.enableFullPageRasterFallback && images.length === 0 && resourceImages.size === 0 && page.render) {
        try {
          const canvas = typeof document !== 'undefined' 
            ? document.createElement('canvas')
            : null;
          
          if (canvas) {
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              const renderResult = page.render({
                canvasContext: ctx,
                viewport
              });
              if (renderResult && typeof renderResult === 'object' && 'promise' in renderResult) {
                await (renderResult as { promise: Promise<unknown> }).promise;
              } else {
                await Promise.resolve(renderResult);
              }
              
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
}
