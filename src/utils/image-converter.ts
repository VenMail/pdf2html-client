import type { PDFImageContent } from '../types/pdf.js';

export class ImageConverter {
  static async convertToImageData(
    image: PDFImageContent
  ): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(imageData);
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      if (typeof image.data === 'string') {
        // Base64 or data URL
        img.src = image.data.startsWith('data:')
          ? image.data
          : `data:image/${image.format};base64,${image.data}`;
      } else {
        // ArrayBuffer
        const blob = new Blob([image.data], {
          type: `image/${image.format}`
        });
        img.src = URL.createObjectURL(blob);
      }
    });
  }

  static async convertArrayBufferToImageData(
    data: ArrayBuffer,
    format: string
  ): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(imageData);
      };

      img.onerror = () => {
        reject(new Error('Failed to load image from ArrayBuffer'));
      };

      const blob = new Blob([data], { type: `image/${format}` });
      img.src = URL.createObjectURL(blob);
    });
  }

  static async renderPageToImage(
    _pageElement: HTMLElement,
    width: number,
    height: number
  ): Promise<ImageData> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    canvas.width = width;
    canvas.height = height;

    // Use html2canvas or similar library for full page rendering
    // For now, return a placeholder
    const imageData = ctx.createImageData(width, height);
    return imageData;
  }

  static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}


