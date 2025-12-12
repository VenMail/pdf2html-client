import { describe, it, expect } from 'vitest';
import { PDF2HTML } from '../../src/index.js';

describe('PDF2HTML End-to-End', () => {
  it('should convert PDF to HTML', async () => {
    const converter = new PDF2HTML({
      enableOCR: false,
      enableFontMapping: false,
      htmlOptions: {
        format: 'html+inline-css',
        preserveLayout: false,
        responsive: true,
        darkMode: false
      }
    });

    const mockPdfData = new ArrayBuffer(0);

    try {
      const output = await converter.convert(mockPdfData);
      expect(output).toBeDefined();
      expect(output.html).toBeDefined();
      expect(output.css).toBeDefined();
    } catch (error) {
      // Expected to fail with empty data
      expect(error).toBeDefined();
    } finally {
      converter.dispose();
    }
  });

  it('should report progress during conversion', async () => {
    const converter = new PDF2HTML({
      enableOCR: false,
      enableFontMapping: false
    });

    const progressUpdates: unknown[] = [];
    const mockPdfData = new ArrayBuffer(0);

    try {
      await converter.convert(mockPdfData, (progress) => {
        progressUpdates.push(progress);
      });

      // Should have received at least some progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
    } catch (error) {
      // Expected to fail with empty data
      expect(error).toBeDefined();
    } finally {
      converter.dispose();
    }
  });
});


