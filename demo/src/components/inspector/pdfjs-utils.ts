export type PDFJSModuleLike = {
  OPS?: Record<string, number>;
  ImageKind?: Record<string, number>;
};

export type PDFJSPageLike = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render?: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise?: Promise<unknown> } | Promise<unknown>;
  objs?: { get: (...args: unknown[]) => unknown };
};

export const toExactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const b = bytes.buffer;
  const isExact = bytes.byteOffset === 0 && bytes.byteLength === b.byteLength;
  if (isExact && b instanceof ArrayBuffer) return b;
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
};

export const multiplyMatrix = (m1: number[], m2: number[]): number[] => {
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

export const transformPoint = (m: number[], x: number, y: number): { x: number; y: number } => {
  const [a, b, c, d, e, f] = m;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
};

export const invertOps = (ops: Record<string, number>): Map<number, string> => {
  const inv = new Map<number, string>();
  for (const [k, v] of Object.entries(ops)) {
    if (typeof v === 'number') inv.set(v, k);
  }
  return inv;
};

export const resolvePdfjsObj = async (page: PDFJSPageLike, id: string): Promise<unknown> => {
  const objs = page.objs;
  if (!objs?.get) return undefined;
  const getFn = objs.get as (...args: unknown[]) => unknown;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const maybe = getFn(id, (value: unknown) => finish(value));
      if (maybe !== undefined) {
        finish(maybe);
      }
      return;
    } catch {
      // ignore
    }

    try {
      finish(getFn(id));
    } catch {
      finish(undefined);
    }
  });
};

export const imageToDataUrl = (pdfjs: PDFJSModuleLike | null, image: unknown): string | null => {
  if (!pdfjs || typeof document === 'undefined') return null;

  if (image instanceof HTMLCanvasElement) {
    try {
      return image.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  // Some pdf.js builds expose decoded images as ImageBitmap.
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  const v = image as {
    width?: number;
    height?: number;
    kind?: number;
    data?: Uint8ClampedArray | Uint8Array;
    bitmap?: unknown;
    image?: unknown;
    imgData?: unknown;
  };

  // pdf.js sometimes nests the actual bitmap.
  if (v?.bitmap) {
    const nested = imageToDataUrl(pdfjs, v.bitmap);
    if (nested) return nested;
  }
  if (v?.image) {
    const nested = imageToDataUrl(pdfjs, v.image);
    if (nested) return nested;
  }
  if (v?.imgData && typeof ImageData !== 'undefined' && v.imgData instanceof ImageData) {
    const canvas = document.createElement('canvas');
    canvas.width = v.imgData.width;
    canvas.height = v.imgData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(v.imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  if (!v || typeof v.width !== 'number' || typeof v.height !== 'number' || !v.data) return null;

  const w = v.width;
  const h = v.height;
  const data = v.data;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const kindRgb = typeof pdfjs.ImageKind?.RGB_24BPP === 'number' ? pdfjs.ImageKind.RGB_24BPP : 2;
  const kindRgba = typeof pdfjs.ImageKind?.RGBA_32BPP === 'number' ? pdfjs.ImageKind.RGBA_32BPP : 3;

  const toArrayBufferBackedClamped = (bytes: Uint8Array | Uint8ClampedArray): Uint8ClampedArray => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ab = toExactArrayBuffer(u8);
    return new Uint8ClampedArray(ab);
  };

  let rgba: Uint8ClampedArray;
  if (v.kind === kindRgb && data.length === w * h * 3) {
    const tmp = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      tmp[j] = data[i];
      tmp[j + 1] = data[i + 1];
      tmp[j + 2] = data[i + 2];
      tmp[j + 3] = 255;
    }
    rgba = tmp;
  } else if (v.kind === kindRgba && data.length === w * h * 4) {
    rgba = toArrayBufferBackedClamped(data instanceof Uint8ClampedArray ? data : data);
  } else if (data.length === w * h * 4) {
    rgba = toArrayBufferBackedClamped(data instanceof Uint8ClampedArray ? data : data);
  } else {
    return null;
  }

  const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
};

export const getObjectShape = (value: unknown): { type: string; ownKeys: string[]; protoKeys: string[] } => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return { type: typeof value, ownKeys: [], protoKeys: [] };
  }

  const ownKeys = Object.getOwnPropertyNames(value);
  const proto = Object.getPrototypeOf(value);
  const protoKeys = proto ? Object.getOwnPropertyNames(proto) : [];
  const type = (value as { constructor?: { name?: string } }).constructor?.name || typeof value;
  return { type, ownKeys, protoKeys };
};
