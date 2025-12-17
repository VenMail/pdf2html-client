/**
 * Utility functions for browser tests
 */

export interface TestConfig {
  enableOCR?: boolean;
  enableFontMapping?: boolean;
}

export async function createConverter(page: any, config: TestConfig = {}) {
  const { PDF2HTML } = await page.evaluate(() => {
    return import('/src/index.ts');
  }).then((mod: any) => mod);

  return new PDF2HTML({
    enableOCR: config.enableOCR ?? false,
    enableFontMapping: config.enableFontMapping ?? false,
    htmlOptions: {
      format: 'html+inline-css',
      preserveLayout: true,
      responsive: true,
      darkMode: false,
    },
  });
}

export function convertPdfToDataUrl(pdfBuffer: Buffer): string {
  const base64 = pdfBuffer.toString('base64');
  return `data:application/pdf;base64,${base64}`;
}

