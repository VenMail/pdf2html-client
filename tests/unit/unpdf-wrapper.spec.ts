import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnPDFWrapper } from '../../src/core/unpdf-wrapper.js';
import type { PDFImageContent } from '../../src/types/pdf.js';

// Mock unpdf module
const mockExtractImages = vi.fn();
const mockGetDocumentProxy = vi.fn();
const mockGetResolvedPDFJS = vi.fn();
const mockDefinePDFJSModule = vi.fn();

vi.mock('unpdf', () => ({
  default: Promise.resolve({
    extractImages: mockExtractImages,
    getDocumentProxy: mockGetDocumentProxy,
    getResolvedPDFJS: mockGetResolvedPDFJS,
    definePDFJSModule: mockDefinePDFJSModule,
  }),
  extractImages: mockExtractImages,
  getDocumentProxy: mockGetDocumentProxy,
  getResolvedPDFJS: mockGetResolvedPDFJS,
  definePDFJSModule: mockDefinePDFJSModule,
}));

describe('UnPDFWrapper image extraction', () => {
  let wrapper: UnPDFWrapper;
  let mockDocument: {
    numPages: number;
    getPage: ReturnType<typeof vi.fn>;
    getMetadata: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    wrapper = new UnPDFWrapper();
    const mockPage = {
      getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
      getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
      getOperatorList: vi.fn().mockResolvedValue({ fnArray: [], argsArray: [] }),
      getAnnotations: vi.fn().mockResolvedValue([]),
    };
    
    mockDocument = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(mockPage),
      getMetadata: vi.fn().mockResolvedValue({
        info: { Title: 'Test PDF', Author: 'Test Author' },
        metadata: {},
      }),
    };
    
    mockGetDocumentProxy.mockResolvedValue(mockDocument);
    mockGetResolvedPDFJS.mockResolvedValue({ OPS: {} });
    mockDefinePDFJSModule.mockResolvedValue(undefined);
    
    // Mock pixelsToPngDataUrl to avoid canvas issues in test environment
    vi.spyOn(wrapper as unknown as { pixelsToPngDataUrl: (pixels: Uint8ClampedArray, width: number, height: number, channels: number) => Promise<string> }, 'pixelsToPngDataUrl').mockImplementation(
      async (pixels: Uint8ClampedArray, width: number, height: number, channels: number) => {
        // Return a simple mock data URL
        return `data:image/png;base64,mock-data-${width}x${height}-${channels}`;
      }
    );
    
    vi.clearAllMocks();
  });

  it('should extract images using unpdf extractImages API correctly', async () => {
    // Mock successful image extraction
    const mockImageData = {
      data: new Uint8ClampedArray([255, 0, 0, 255]), // Red pixel
      width: 100,
      height: 100,
      channels: 4 as const,
      key: 'test-image-key',
    };

    mockExtractImages.mockResolvedValue([mockImageData]);

    // Load document
    await wrapper.loadDocument(new ArrayBuffer(100));

    // Test the extractImagesFallbackUnpdf method directly
    const images = await (wrapper as unknown as { extractImagesFallbackUnpdf: (pageNumber: number) => Promise<PDFImageContent[]> }).extractImagesFallbackUnpdf(0);

    expect(mockExtractImages).toHaveBeenCalledWith(
      mockDocument,
      1 // pageNumber (1-based)
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      format: 'png',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(images[0].data).toMatch(/^data:image\/png;base64,/);
  });

  it('should handle unpdf extractImages failures gracefully', async () => {
    // Mock extractImages failure
    mockExtractImages.mockRejectedValue(new Error('Extraction failed'));

    await wrapper.loadDocument(new ArrayBuffer(100));

    const page = await wrapper.parsePage(0, { extractImages: true });

    expect(page.content.images).toHaveLength(0);
  });

  it('should handle missing extractImages function', async () => {
    // Mock unpdf without extractImages function
    const mockUnpdfWithoutExtractImages = {
      getDocumentProxy: mockGetDocumentProxy,
      getResolvedPDFJS: mockGetResolvedPDFJS,
      definePDFJSModule: mockDefinePDFJSModule,
    };

    vi.doMock('unpdf', () => mockUnpdfWithoutExtractImages);

    await wrapper.loadDocument(new ArrayBuffer(100));

    const page = await wrapper.parsePage(0, { extractImages: true });

    expect(page.content.images).toHaveLength(0);
  });

  it('should convert different image channel formats correctly', async () => {
    // Test different channel formats
    const mockImages = [
      {
        data: new Uint8ClampedArray([255, 0, 0]), // RGB
        width: 50,
        height: 50,
        channels: 3 as const,
        key: 'rgb-image',
      },
      {
        data: new Uint8ClampedArray([128]), // Grayscale
        width: 25,
        height: 25,
        channels: 1 as const,
        key: 'gray-image',
      },
      {
        data: new Uint8ClampedArray([255, 0, 0, 128]), // RGBA
        width: 75,
        height: 75,
        channels: 4 as const,
        key: 'rgba-image',
      },
    ];

    mockExtractImages.mockResolvedValue(mockImages);

    await wrapper.loadDocument(new ArrayBuffer(100));

    // Test the extractImagesFallbackUnpdf method directly
    const images = await (wrapper as unknown as { extractImagesFallbackUnpdf: (pageNumber: number) => Promise<PDFImageContent[]> }).extractImagesFallbackUnpdf(0);

    expect(images).toHaveLength(3);
    
    // Verify all images were converted to PNG data URLs
    images.forEach((image: PDFImageContent, index: number) => {
      expect(image.format).toBe('png');
      expect(image.data).toMatch(/^data:image\/png;base64,/);
      expect(image.width).toBe(mockImages[index].width);
      expect(image.height).toBe(mockImages[index].height);
    });
  });
});
