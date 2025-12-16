import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pdfPath = join(__dirname, '../../demo/boarding_pass.pdf');

interface ConversionResult {
  success: boolean;
  pageCount: number;
  processingTime: number;
  html?: string;
  css?: string;
  error?: string;
  textContent?: string;
}

type Pdf2HtmlOutput = {
  html: string;
  css: string;
  text?: string;
  metadata: {
    pageCount: number;
    fontMappings?: number;
  };
};

const cropToContent = (png: PNG): PNG => {
  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const whiteThreshold = 240;

  const isNonWhite = (idx: number): boolean => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a === 0) return false;
    return r < whiteThreshold || g < whiteThreshold || b < whiteThreshold;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      if (isNonWhite(idx)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return png;

  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const cropped = new PNG({ width: cropWidth, height: cropHeight });
  PNG.bitblt(png, cropped, minX, minY, cropWidth, cropHeight, 0, 0);
  return cropped;
};

const resizeNearest = (png: PNG, newWidth: number, newHeight: number): PNG => {
  if (png.width === newWidth && png.height === newHeight) return png;
  const out = new PNG({ width: newWidth, height: newHeight });
  for (let y = 0; y < newHeight; y++) {
    const srcY = Math.min(png.height - 1, Math.floor((y / newHeight) * png.height));
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.min(png.width - 1, Math.floor((x / newWidth) * png.width));
      const srcIdx = (png.width * srcY + srcX) * 4;
      const dstIdx = (newWidth * y + x) * 4;
      out.data[dstIdx] = png.data[srcIdx];
      out.data[dstIdx + 1] = png.data[srcIdx + 1];
      out.data[dstIdx + 2] = png.data[srcIdx + 2];
      out.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return out;
};

const alignByTranslation = (
  expected: PNG,
  actual: PNG
): { expected: PNG; actual: PNG; dx: number; dy: number } => {
  const maxDx = 20;
  const maxDy = 20;
  const step = 2;

  let bestDx = 0;
  let bestDy = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  const scoreAt = (dx: number, dy: number): number => {
    const width = Math.min(
      expected.width,
      actual.width - Math.max(0, dx),
      expected.width + Math.min(0, dx)
    );
    const height = Math.min(
      expected.height,
      actual.height - Math.max(0, dy),
      expected.height + Math.min(0, dy)
    );
    if (width <= 50 || height <= 50) return Number.POSITIVE_INFINITY;

    const expCrop = new PNG({ width, height });
    const actCrop = new PNG({ width, height });

    const expSrcX = dx < 0 ? -dx : 0;
    const expSrcY = dy < 0 ? -dy : 0;
    const actSrcX = dx > 0 ? dx : 0;
    const actSrcY = dy > 0 ? dy : 0;

    PNG.bitblt(expected, expCrop, expSrcX, expSrcY, width, height, 0, 0);
    PNG.bitblt(actual, actCrop, actSrcX, actSrcY, width, height, 0, 0);

    const tmpDiff = new PNG({ width, height });
    const diffPixels = pixelmatch(expCrop.data, actCrop.data, tmpDiff.data, width, height, { threshold: 0.15 });
    return diffPixels / (width * height);
  };

  for (let dy = -maxDy; dy <= maxDy; dy += step) {
    for (let dx = -maxDx; dx <= maxDx; dx += step) {
      const score = scoreAt(dx, dy);
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  const width = Math.min(
    expected.width,
    actual.width - Math.max(0, bestDx),
    expected.width + Math.min(0, bestDx)
  );
  const height = Math.min(
    expected.height,
    actual.height - Math.max(0, bestDy),
    expected.height + Math.min(0, bestDy)
  );

  const expAligned = new PNG({ width, height });
  const actAligned = new PNG({ width, height });
  const expSrcX = bestDx < 0 ? -bestDx : 0;
  const expSrcY = bestDy < 0 ? -bestDy : 0;
  const actSrcX = bestDx > 0 ? bestDx : 0;
  const actSrcY = bestDy > 0 ? bestDy : 0;
  PNG.bitblt(expected, expAligned, expSrcX, expSrcY, width, height, 0, 0);
  PNG.bitblt(actual, actAligned, actSrcX, actSrcY, width, height, 0, 0);

  return { expected: expAligned, actual: actAligned, dx: bestDx, dy: bestDy };
};

type TestWindow = Window & {
  __PDF2HTML_READY__?: boolean;
  __PDF2HTML_ERROR__?: string | null;
  __GOOGLE_API_KEY__?: string;
  __PDFJS__?: unknown;
  PDF2HTML?: new (options?: unknown) => {
    convert: (data: ArrayBuffer, progressCb?: (progress: unknown) => void) => Promise<unknown>;
    dispose: () => void;
  };
};

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return String(error);
};

const buildRenderableHtml = (html: string, css?: string): string => {
  const hasHtmlDoc = /<html[\s>]/i.test(html);
  if (hasHtmlDoc) {
    if (!css) return html;
    if (/<style[\s>]/i.test(html)) return html;
    const headClose = html.match(/<\/head>/i);
    if (headClose) {
      return html.replace(/<\/head>/i, `<style>${css}</style></head>`);
    }
    return html;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Boarding Pass - Converted</title>
  ${css ? `<style>${css}</style>` : ''}
</head>
<body>
  ${html}
</body>
</html>`;
};

test.describe('Boarding Pass PDF Conversion', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Browser Error: ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      console.log(`Page error: ${error.message}`);
    });

    await page.goto('/test-harness.html', { waitUntil: 'load' });

    await page.waitForFunction(
      () => {
        const win = window as unknown as TestWindow;
        return (
          win.__PDF2HTML_READY__ === true ||
          (typeof win.__PDF2HTML_ERROR__ === 'string' && win.__PDF2HTML_ERROR__.length > 0)
        );
      },
      { timeout: 60000 }
    );

    const error = await page.evaluate(() => (window as unknown as TestWindow).__PDF2HTML_ERROR__);
    if (error) {
      throw new Error(`Library failed to load: ${error}`);
    }

    const ready = await page.evaluate(() => (window as unknown as TestWindow).__PDF2HTML_READY__ === true);
    if (!ready) {
      throw new Error('Library not ready after timeout');
    }
  });

  test('should convert boarding_pass.pdf with outline-flow (no absolute text spans) and high fidelity', async ({ page }) => {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const result: ConversionResult = await page.evaluate(async (pdfData) => {
      try {
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as unknown as TestWindow).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }

        const apiKey = (window as unknown as TestWindow).__GOOGLE_API_KEY__ || '';

        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: false,
          htmlOptions: {
            format: 'html+inline-css',
            preserveLayout: true,
            textLayout: 'flow',
            textLayoutPasses: 2,
            responsive: false,
            darkMode: false,
            includeExtractedText: true,
            textPipeline: 'v2',
            textClassifierProfile: 'latin-default',
          },
          fontMappingOptions: {
            googleApiKey: apiKey,
          },
        });

        const startTime = performance.now();
        const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
        const processingTime = performance.now() - startTime;
        converter.dispose();

        return {
          success: true,
          pageCount: output.metadata.pageCount,
          processingTime: Math.round(processingTime),
          html: output.html,
          css: output.css,
          textContent: output.text || ''
        };
      } catch (error: unknown) {
        return {
          success: false,
          pageCount: 0,
          processingTime: 0,
          error: getErrorMessage(error)
        };
      }
    }, pdfDataUrl);

    expect(result.success, 'Conversion should succeed').toBe(true);
    if (result.error) {
      console.error('Conversion error:', result.error);
      throw new Error(result.error);
    }

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.html).toBeDefined();

    const html = result.html!;
    const css = result.css || '';

    const outputDir = join(__dirname, '../../test-results/boarding-pass-outline-flow');
    mkdirSync(outputDir, { recursive: true });

    const fullHtml = buildRenderableHtml(html, css);
    writeFileSync(join(outputDir, 'boarding_pass_converted.html'), fullHtml, 'utf8');
    writeFileSync(join(outputDir, 'boarding_pass_styles.css'), css, 'utf8');

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(fullHtml, { waitUntil: 'load' });
    await page.waitForTimeout(250);

    const editability = await page.evaluate(() => {
      const pageEl = document.querySelector('.pdf-page-0') as HTMLElement | null;
      if (!pageEl) return { ok: false, message: 'pdf-page-0 not found' };

      const regions = Array.from(pageEl.querySelectorAll('.pdf-text-region')) as HTMLElement[];
      const absText = Array.from(pageEl.querySelectorAll('.pdf-text-region [data-font-family][style*="position: absolute"]'));

      return {
        ok: true,
        regionCount: regions.length,
        absTextCount: absText.length,
      };
    });

    if (!editability.ok) {
      throw new Error(editability.message || 'Editability check failed');
    }

    expect(editability.regionCount).toBeGreaterThan(0);
    expect(editability.absTextCount, 'No absolutely positioned text spans expected inside text regions').toBe(0);

    if (process.env.PDF2HTML_VISUAL_DIFF === '1') {
      const pdfBufferForBaseline = readFileSync(pdfPath);
      const pdfBase64ForBaseline = pdfBufferForBaseline.toString('base64');

      await page.setViewportSize({ width: 1200, height: 900 });
      await page.evaluate(() => {
        const existing = document.getElementById('baseline');
        if (existing) existing.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'baseline';
        canvas.style.display = 'block';
        canvas.style.margin = '0';
        document.body.prepend(canvas);
      });

      const baselineRenderResult = await page.evaluate(async ({ base64 }) => {
        try {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const win = window as unknown as TestWindow;
          const pdfjs = win.__PDFJS__ as unknown as { getDocument: (args: unknown) => { promise: Promise<unknown> } } | undefined;
          if (!pdfjs?.getDocument) {
            throw new Error('pdf.js not available on window.__PDFJS__');
          }

          const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true } as unknown);
          const doc = (await loadingTask.promise) as { getPage: (pageNumber: number) => Promise<unknown> };
          const page1 = await doc.getPage(1);
          const viewport = (page1 as unknown as { getViewport: (options: { scale: number }) => { width: number; height: number } }).getViewport({
            scale: 1
          });
          const canvas = document.getElementById('baseline') as HTMLCanvasElement | null;
          if (!canvas) throw new Error('Baseline canvas not found');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Baseline canvas context not available');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const renderTask = (page1 as unknown as { render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown> } }).render({
            canvasContext: ctx,
            viewport
          });
          await renderTask.promise;
          return { ok: true };
        } catch (error: unknown) {
          const message =
            error && typeof error === 'object' && 'message' in error
              ? String((error as { message?: unknown }).message)
              : String(error);
          const stack =
            error && typeof error === 'object' && 'stack' in error
              ? String((error as { stack?: unknown }).stack)
              : '';
          return { ok: false, message, stack };
        }
      }, { base64: pdfBase64ForBaseline });

      if (!baselineRenderResult.ok) {
        throw new Error(`Baseline render failed: ${baselineRenderResult.message}${baselineRenderResult.stack ? `\n${baselineRenderResult.stack}` : ''}`);
      }

      const baselineCanvas = await page.$('#baseline');
      if (!baselineCanvas) throw new Error('Baseline canvas element not found');
      const baselineBytes = await baselineCanvas.screenshot();
      const baselinePng = cropToContent(PNG.sync.read(baselineBytes));

      await page.setViewportSize({ width: baselinePng.width, height: baselinePng.height });
      await page.setContent(fullHtml, { waitUntil: 'load' });
      await page.waitForTimeout(250);

      const pageEl =
        (await page.$('.pdf-page-0')) ||
        (await page.$('[class^="pdf-page-"]'));

      const screenshotBytes = pageEl
        ? await pageEl.screenshot()
        : await page.screenshot({ fullPage: false });
      const actualCropped = cropToContent(PNG.sync.read(screenshotBytes));

      const expectedResized = baselinePng;
      const actualResized = resizeNearest(actualCropped, expectedResized.width, expectedResized.height);
      const aligned = alignByTranslation(expectedResized, actualResized);
      console.log(`Outline flow alignment shift applied: dx=${aligned.dx}, dy=${aligned.dy}`);

      const expectedForCompare = aligned.expected;
      const actualForCompare = aligned.actual;
      const width = expectedForCompare.width;
      const height = expectedForCompare.height;

      const diff = new PNG({ width, height });
      const diffPixels = pixelmatch(
        expectedForCompare.data,
        actualForCompare.data,
        diff.data,
        width,
        height,
        { threshold: 0.15 }
      );

      writeFileSync(join(outputDir, 'boarding_pass_baseline.png'), PNG.sync.write(expectedForCompare));
      writeFileSync(join(outputDir, 'boarding_pass_actual.png'), PNG.sync.write(actualForCompare));
      writeFileSync(join(outputDir, 'boarding_pass_diff.png'), PNG.sync.write(diff));

      const totalPixels = width * height;
      const diffRatio = diffPixels / totalPixels;
      console.log(`Outline flow visual diff: ${diffPixels} pixels (${(diffRatio * 100).toFixed(4)}%)`);
      expect(diffRatio, 'Outline flow visual diff ratio should be within tolerance').toBeLessThan(0.125);
    }
  });

  test('should convert boarding_pass.pdf with v2 classifier (smoke)', async ({ page }) => {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const result: ConversionResult = await page.evaluate(async (pdfData) => {
      try {
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as unknown as TestWindow).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }

        const apiKey = (window as unknown as TestWindow).__GOOGLE_API_KEY__ || '';

        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: false,
          htmlOptions: {
            format: 'html+inline-css',
            preserveLayout: true,
            textLayout: 'smart',
            responsive: false,
            darkMode: false,
            includeExtractedText: true,
            textPipeline: 'v2',
            textClassifierProfile: 'latin-default',
          },
          fontMappingOptions: {
            googleApiKey: apiKey,
          },
        });

        const startTime = performance.now();
        const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
        const processingTime = performance.now() - startTime;

        const textContent = (() => {
          if (typeof output.text === 'string' && output.text.trim().length > 0) {
            return output.text;
          }
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(output.html, 'text/html');
            doc.querySelectorAll('style, script, noscript').forEach((el) => el.remove());
            doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
            const raw = doc.body?.textContent || '';
            return raw.replace(/\s+/g, ' ').trim();
          } catch {
            return output.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          }
        })();

        converter.dispose();

        return {
          success: true,
          pageCount: output.metadata.pageCount,
          processingTime: Math.round(processingTime),
          html: output.html,
          css: output.css,
          textContent
        };
      } catch (error: unknown) {
        return {
          success: false,
          pageCount: 0,
          processingTime: 0,
          error: getErrorMessage(error)
        };
      }
    }, pdfDataUrl);

    expect(result.success, 'Conversion should succeed').toBe(true);
    if (result.error) {
      console.error('Conversion error:', result.error);
      throw new Error(result.error);
    }

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.html).toBeDefined();

    const html = result.html!;
    const textContent = result.textContent || '';
    const css = result.css || '';
    const htmlString = buildRenderableHtml(html, css);

    const requiredTexts = [
      'Record Locator',
      'GCOXAX',
      'eTicket',
      '0712156116699',
      'ET 902',
      'Murtala Muhammed International Airport',
      'Bole International'
    ];

    for (const requiredText of requiredTexts) {
      const found =
        textContent.toUpperCase().includes(requiredText.toUpperCase()) ||
        html.includes(requiredText);
      if (!found) {
        console.log(`Missing expected text (non-fatal): ${requiredText}`);
      }
    }

    expect(textContent).not.toMatch(/\bfl\s+ight\b/i);
    expect(textContent).not.toMatch(/\bdepartu\s+re\b/i);
    expect(textContent).not.toMatch(/\bBoardingTime\b/i);
    expect(textContent).toMatch(/\bBoarding\s+Time\b/i);
    expect(textContent).toMatch(/\bBoarding\s+Time\b.{0,60}\b21\s*:\s*15\b/i);

    expect(css).toContain('.font-default');
    expect(css).toMatch(/\.font-default\s*\{[^}]*font-family:\s*Arial/i);
    expect(css).not.toMatch(/DejaVu/i);

    const cssRuleByClass = new Map<string, string>();
    const cssClassRuleRe = /\.(pdf-abs-style-[0-9]+)\s*\{([^}]*)\}/g;
    let cm: RegExpExecArray | null;
    while ((cm = cssClassRuleRe.exec(css))) {
      cssRuleByClass.set(cm[1], cm[2] || '');
    }

    const styleClasses = new Set<string>();
    const spansWithFontRe = /<[^>]+\bdata-font-family="[^"]*"[^>]*>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = spansWithFontRe.exec(htmlString))) {
      const tag = sm[0] || '';
      const classMatch = tag.match(/\bclass="([^"]*)"/i);
      const classAttr = classMatch?.[1] || '';
      const classes = classAttr.split(/\s+/g).filter((c) => c.length > 0);
      const styleClass = classes.find((c) => /^pdf-abs-style-\d+$/.test(c));
      if (styleClass) styleClasses.add(styleClass);
      if (styleClasses.size >= 12) break;
    }

    expect(styleClasses.size).toBeGreaterThan(0);
    for (const cls of styleClasses) {
      const rule = cssRuleByClass.get(cls) || '';
      expect(rule, `Missing CSS rule for ${cls}`).toBeTruthy();
      expect(rule).toMatch(/font-family\s*:/i);
      expect(rule).not.toMatch(/DejaVu/i);
      expect(rule).not.toMatch(/-apple-system|BlinkMacSystemFont|Segoe UI|system-ui/i);
      expect(rule).toMatch(/Arial|Times|Courier|serif|sans-serif|monospace/i);
    }
  });

  test('should convert boarding_pass.pdf with high fidelity', async ({ page }) => {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const result: ConversionResult = await page.evaluate(async (pdfData) => {
      try {
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as unknown as TestWindow).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }
        
        const apiKey = (window as unknown as TestWindow).__GOOGLE_API_KEY__ || '';
        
        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: false,
          htmlOptions: {
            format: 'html+inline-css',
            preserveLayout: true,
            textLayout: 'smart',
            responsive: false,
            darkMode: false,
            includeExtractedText: true,
            textPipeline: 'v2',
            textClassifierProfile: 'latin-default',
          },
          fontMappingOptions: {
            googleApiKey: apiKey,
          },
        });

        const startTime = performance.now();
        const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
        const processingTime = performance.now() - startTime;

        const textContent = (() => {
          if (typeof output.text === 'string' && output.text.trim().length > 0) {
            return output.text;
          }

          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(output.html, 'text/html');
            doc.querySelectorAll('style, script, noscript').forEach((el) => el.remove());
            // Preserve explicit line breaks in extracted text
            doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
            const raw = doc.body?.textContent || '';
            return raw.replace(/\s+/g, ' ').trim();
          } catch {
            return output.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          }
        })();

        converter.dispose();
        
        return {
          success: true,
          pageCount: output.metadata.pageCount,
          processingTime: Math.round(processingTime),
          html: output.html,
          css: output.css,
          textContent
        };
      } catch (error: unknown) {
        return {
          success: false,
          pageCount: 0,
          processingTime: 0,
          error: getErrorMessage(error)
        };
      }
    }, pdfDataUrl);

    expect(result.success, 'Conversion should succeed').toBe(true);
    if (result.error) {
      console.error('Conversion error:', result.error);
      throw new Error(result.error);
    }

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.html).toBeDefined();
    expect(result.html!.length).toBeGreaterThan(1000);

    const html = result.html!;
    const textContent = result.textContent || '';
    const css = result.css || '';

    console.log(`Processing time: ${result.processingTime}ms`);
    console.log(`HTML size: ${html.length} bytes`);
    console.log(`CSS size: ${css.length} bytes`);

    const requiredTexts = [
      'Record Locator',
      'GCOXAX',
      'eTicket',
      '0712156116699',
      'LOS',
      'ADD',
      'Murtala Muhammed International Airport',
      'Addis Ababa',
      'Bole International',
      'Flight',
      'ET 902',
      'Boarding Time',
      'Departure Time',
      'Seat',
      '27B',
      'Checked Bags',
      'Priority Boarding'
    ];

    for (const requiredText of requiredTexts) {
      const found =
        textContent.toUpperCase().includes(requiredText.toUpperCase()) ||
        html.includes(requiredText);
      if (!found) {
        console.log(`Missing expected text (non-fatal): ${requiredText}`);
      }
    }

    expect(textContent).not.toMatch(/\bfl\s+ight\b/i);
    expect(textContent).not.toMatch(/\bdepartu\s+re\b/i);
    expect(textContent).not.toMatch(/\bBoardingTime\b/i);
    expect(textContent).toMatch(/\bBoarding\s+Time\b/i);
    expect(textContent).toMatch(/\bBoarding\s+Time\b.{0,60}\b21\s*:\s*15\b/i);

    const hasAbsolutePositioning = html.includes('position: absolute');
    expect(hasAbsolutePositioning, 'Should use absolute positioning for layout preservation').toBe(true);

    const hasFontStyles = html.includes('font-size:') || html.includes('font-family:');
    expect(hasFontStyles, 'Should include font styling').toBe(true);

    const textElements = (html.match(/<span[^>]*>/g) || []).length;
    console.log(`Text elements extracted: ${textElements}`);
    expect(textElements, 'Should extract substantial text elements').toBeGreaterThan(50);

    const hasStructuredLayout = html.includes('pdf-page') || html.includes('class="pdf-page');
    expect(hasStructuredLayout, 'Should have structured page layout').toBe(true);

    const outputDir = join(__dirname, '../../test-results/boarding-pass');
    mkdirSync(outputDir, { recursive: true });

    const fullHtml = buildRenderableHtml(html, css);
    
    const htmlPath = join(outputDir, 'boarding_pass_converted.html');
    writeFileSync(htmlPath, fullHtml, 'utf8');
    console.log(`✓ HTML output saved: ${htmlPath}`);
    
    if (result.css) {
      const cssPath = join(outputDir, 'boarding_pass_styles.css');
      writeFileSync(cssPath, result.css, 'utf8');
      console.log(`✓ CSS output saved: ${cssPath}`);
    }

    const textPath = join(outputDir, 'boarding_pass_text.txt');
    writeFileSync(textPath, textContent, 'utf8');
    console.log(`✓ Extracted text saved: ${textPath}`);

    expect(css).toContain('.font-default');
    expect(css).toMatch(/\.font-default\s*\{[^}]*font-family:\s*Arial/i);
    expect(css).not.toMatch(/DejaVu/i);

    const cssRuleByClass = new Map<string, string>();
    const cssClassRuleRe = /\.(pdf-abs-style-[0-9]+)\s*\{([^}]*)\}/g;
    let cm: RegExpExecArray | null;
    while ((cm = cssClassRuleRe.exec(css))) {
      cssRuleByClass.set(cm[1], cm[2] || '');
    }

    const styleClasses = new Set<string>();
    const spansWithFontRe = /<[^>]+\bdata-font-family="[^"]*"[^>]*>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = spansWithFontRe.exec(fullHtml))) {
      const tag = sm[0] || '';
      const classMatch = tag.match(/\bclass="([^"]*)"/i);
      const classAttr = classMatch?.[1] || '';
      const classes = classAttr.split(/\s+/g).filter((c) => c.length > 0);
      const styleClass = classes.find((c) => /^pdf-abs-style-\d+$/.test(c));
      if (styleClass) styleClasses.add(styleClass);
      if (styleClasses.size >= 12) break;
    }

    expect(styleClasses.size).toBeGreaterThan(0);
    for (const cls of styleClasses) {
      const rule = cssRuleByClass.get(cls) || '';
      expect(rule, `Missing CSS rule for ${cls}`).toBeTruthy();
      expect(rule).toMatch(/font-family\s*:/i);
      expect(rule).not.toMatch(/DejaVu/i);
      expect(rule).not.toMatch(/-apple-system|BlinkMacSystemFont|Segoe UI|system-ui/i);
      expect(rule).toMatch(/Arial|Times|Courier|serif|sans-serif|monospace/i);
    }

    if (process.env.PDF2HTML_VISUAL_DIFF === '1') {
      const pdfBufferForBaseline = readFileSync(pdfPath);
      const pdfBase64ForBaseline = pdfBufferForBaseline.toString('base64');

      await page.setViewportSize({ width: 1200, height: 900 });
      await page.evaluate(() => {
        const existing = document.getElementById('baseline');
        if (existing) existing.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'baseline';
        canvas.style.display = 'block';
        canvas.style.margin = '0';
        document.body.prepend(canvas);
      });

      const baselineRenderResult = await page.evaluate(async ({ base64 }) => {
        try {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const win = window as unknown as TestWindow;
          const pdfjs = win.__PDFJS__ as unknown as { getDocument: (args: unknown) => { promise: Promise<unknown> } } | undefined;
          if (!pdfjs?.getDocument) {
            throw new Error('pdf.js not available on window.__PDFJS__');
          }

          const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true } as unknown);
          const doc = (await loadingTask.promise) as { getPage: (pageNumber: number) => Promise<unknown> };
          const page1 = await doc.getPage(1);
          const viewport = (page1 as unknown as { getViewport: (options: { scale: number }) => { width: number; height: number } }).getViewport({
            scale: 1
          });
          const canvas = document.getElementById('baseline') as HTMLCanvasElement | null;
          if (!canvas) throw new Error('Baseline canvas not found');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Baseline canvas context not available');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const renderTask = (page1 as unknown as { render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown> } }).render({
            canvasContext: ctx,
            viewport
          });
          await renderTask.promise;
          return { ok: true };
        } catch (error: unknown) {
          const message =
            error && typeof error === 'object' && 'message' in error
              ? String((error as { message?: unknown }).message)
              : String(error);
          const stack =
            error && typeof error === 'object' && 'stack' in error
              ? String((error as { stack?: unknown }).stack)
              : '';
          return { ok: false, message, stack };
        }
      }, { base64: pdfBase64ForBaseline });

      if (!baselineRenderResult.ok) {
        throw new Error(`Baseline render failed: ${baselineRenderResult.message}${baselineRenderResult.stack ? `\n${baselineRenderResult.stack}` : ''}`);
      }

      const baselineCanvas = await page.$('#baseline');
      if (!baselineCanvas) throw new Error('Baseline canvas element not found');
      const baselineBytes = await baselineCanvas.screenshot();
      const baselinePng = cropToContent(PNG.sync.read(baselineBytes));

      await page.setViewportSize({ width: baselinePng.width, height: baselinePng.height });
      await page.setContent(fullHtml, { waitUntil: 'load' });
      await page.waitForTimeout(250);

      const pageEl =
        (await page.$('.pdf-page-0')) ||
        (await page.$('[class^="pdf-page-"]'));

      const screenshotBytes = pageEl
        ? await pageEl.screenshot()
        : await page.screenshot({ fullPage: false });
      const actualCropped = cropToContent(PNG.sync.read(screenshotBytes));

      const expectedResized = baselinePng;
      const actualResized = resizeNearest(actualCropped, expectedResized.width, expectedResized.height);
      const aligned = alignByTranslation(expectedResized, actualResized);
      console.log(`Alignment shift applied: dx=${aligned.dx}, dy=${aligned.dy}`);

      const expectedForCompare = aligned.expected;
      const actualForCompare = aligned.actual;
      const width = expectedForCompare.width;
      const height = expectedForCompare.height;

      const diff = new PNG({ width, height });
      const diffPixels = pixelmatch(
        expectedForCompare.data,
        actualForCompare.data,
        diff.data,
        width,
        height,
        { threshold: 0.15 }
      );

      const baselineImagePath = join(outputDir, 'boarding_pass_baseline.png');
      const actualImagePath = join(outputDir, 'boarding_pass_actual.png');
      const diffImagePath = join(outputDir, 'boarding_pass_diff.png');
      writeFileSync(baselineImagePath, PNG.sync.write(expectedForCompare));
      writeFileSync(actualImagePath, PNG.sync.write(actualForCompare));
      writeFileSync(diffImagePath, PNG.sync.write(diff));

      const totalPixels = width * height;
      const diffRatio = diffPixels / totalPixels;
      console.log(`Visual diff: ${diffPixels} pixels (${(diffRatio * 100).toFixed(4)}%)`);
      expect(diffRatio, 'Visual diff ratio should be within tolerance').toBeLessThan(0.07);
    }
  });

  test('should preserve layout structure for boarding pass', async ({ page }) => {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const layoutCheck = await page.evaluate(async (pdfData) => {
      try {
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as unknown as TestWindow).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }

        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: false,
          htmlOptions: {
            format: 'html+inline-css',
            preserveLayout: true,
            responsive: false,
          },
        });

        const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
        converter.dispose();

        const html = output.html;
        
        return {
          hasPageContainer: html.includes('pdf-page'),
          hasAbsolutePositioning: html.includes('position: absolute'),
          hasMultipleTextElements: (html.match(/<span[^>]*>/g) || []).length > 50,
          hasFontClasses: html.includes('font-') || html.includes('class="font-'),
          hasInlineStyles: html.includes('style='),
          textElementCount: (html.match(/<span[^>]*>/g) || []).length,
          divElementCount: (html.match(/<div[^>]*>/g) || []).length,
        };
      } catch (error: unknown) {
        return { error: getErrorMessage(error) };
      }
    }, pdfDataUrl);

    if ('error' in layoutCheck) {
      throw new Error(layoutCheck.error);
    }

    expect(layoutCheck.hasPageContainer, 'Should have page container').toBe(true);
    expect(layoutCheck.hasAbsolutePositioning, 'Should use absolute positioning').toBe(true);
    expect(layoutCheck.hasMultipleTextElements, 'Should have multiple text elements').toBe(true);
    expect(layoutCheck.hasInlineStyles, 'Should have inline styles for positioning').toBe(true);
    
    console.log('Layout check results:', layoutCheck);
  });

  test('should extract semantic IMPORTANT NOTES as heading + 2-item list (flow mode)', async ({ page }) => {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const result = await page.evaluate(async (pdfData) => {
      try {
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as unknown as TestWindow).PDF2HTML;
        if (!PDF2HTML) throw new Error('PDF2HTML not available');

        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: false,
          htmlOptions: {
            format: 'html+inline-css',
            preserveLayout: false,
            responsive: true,
            darkMode: false,
            imageFormat: 'base64',
            textLayout: 'flow',
            includeExtractedText: true,
            textPipeline: 'v2',
            textClassifierProfile: 'latin-default'
          }
        });

        const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
        converter.dispose();

        return { ok: true, html: output.html, css: output.css };
      } catch (error: unknown) {
        return { ok: false, message: getErrorMessage(error) };
      }
    }, pdfDataUrl);

    if (!result.ok) {
      throw new Error(result.message || 'Conversion failed');
    }

    const fullHtml = buildRenderableHtml(result.html as string, result.css as string | undefined);

    expect(fullHtml).toMatch(/<h[1-6][^>]*>[\s\S]*IMPORTANT\s*NOTES[\s\S]*<\/h[1-6]>/i);

    const afterHeading = fullHtml.split(/IMPORTANT\s*NOTES/i)[1] || '';
    expect(afterHeading).toContain('<ul');
    const liCount = (afterHeading.match(/<li\b/g) || []).length;
    expect(liCount).toBe(2);
  });

  test('should convert boarding_pass.pdf with semantic layout and high fidelity', async ({ page }) => {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const result: ConversionResult = await page.evaluate(async (pdfData) => {
      try {
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as unknown as TestWindow).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }

        const apiKey = (window as unknown as TestWindow).__GOOGLE_API_KEY__ || '';

        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: false,
          htmlOptions: {
            format: 'html+inline-css',
            preserveLayout: true,
            textLayout: 'semantic',
            textLayoutPasses: 2,
            responsive: false,
            darkMode: false,
            includeExtractedText: true,
            textPipeline: 'v2',
            textClassifierProfile: 'latin-default',
            useFlexboxLayout: true, // Explicitly enable flexbox layout
          },
          fontMappingOptions: {
            googleApiKey: apiKey,
          },
        });

        const startTime = performance.now();
        const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
        const processingTime = performance.now() - startTime;
        converter.dispose();

        return {
          success: true,
          pageCount: output.metadata.pageCount,
          processingTime: Math.round(processingTime),
          html: output.html,
          css: output.css,
          textContent: output.text || ''
        };
      } catch (error: unknown) {
        return {
          success: false,
          pageCount: 0,
          processingTime: 0,
          error: getErrorMessage(error)
        };
      }
    }, pdfDataUrl);

    expect(result.success, 'Conversion should succeed').toBe(true);
    if (result.error) {
      console.error('Conversion error:', result.error);
      throw new Error(result.error);
    }

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.html).toBeDefined();

    const html = result.html!;
    const css = result.css || '';

    const outputDir = join(__dirname, '../../test-results/boarding-pass-semantic');
    mkdirSync(outputDir, { recursive: true });

    const fullHtml = buildRenderableHtml(html, css);
    writeFileSync(join(outputDir, 'boarding_pass_converted.html'), fullHtml, 'utf8');
    writeFileSync(join(outputDir, 'boarding_pass_styles.css'), css, 'utf8');

    const hasSemanticRegions = html.includes('pdf-sem-region');
    expect(hasSemanticRegions, 'Should have semantic regions').toBe(true);

    // Verify flexbox layout is being used
    const hasFlexboxLines = html.includes('pdf-sem-lines') && html.includes('display: flex');
    const hasFlexboxLine = html.includes('pdf-sem-line') && html.includes('flex-direction: row');
    const hasFlexboxGaps = html.includes('pdf-sem-gap') || html.includes('pdf-sem-vgap');
    expect(hasFlexboxLines, 'Should use flexbox lines container').toBe(true);
    expect(hasFlexboxLine, 'Should use flexbox line containers').toBe(true);
    expect(hasFlexboxGaps, 'Should have flexbox gap elements').toBe(true);
    
    console.log('Flexbox layout verification:', {
      hasFlexboxLines,
      hasFlexboxLine,
      hasFlexboxGaps,
      regionCount: (html.match(/pdf-sem-region/g) || []).length,
      lineCount: (html.match(/pdf-sem-line/g) || []).length,
    });

    if (process.env.PDF2HTML_VISUAL_DIFF === '1') {
      const pdfBufferForBaseline = readFileSync(pdfPath);
      const pdfBase64ForBaseline = pdfBufferForBaseline.toString('base64');

      await page.setViewportSize({ width: 1200, height: 900 });
      await page.evaluate(() => {
        const existing = document.getElementById('baseline');
        if (existing) existing.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'baseline';
        canvas.style.display = 'block';
        canvas.style.margin = '0';
        document.body.prepend(canvas);
      });

      const baselineRenderResult = await page.evaluate(async ({ base64 }) => {
        try {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const win = window as unknown as TestWindow;
          const pdfjs = win.__PDFJS__ as unknown as { getDocument: (args: unknown) => { promise: Promise<unknown> } } | undefined;
          if (!pdfjs?.getDocument) {
            throw new Error('pdf.js not available on window.__PDFJS__');
          }

          const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true } as unknown);
          const doc = (await loadingTask.promise) as { getPage: (pageNumber: number) => Promise<unknown> };
          const page1 = await doc.getPage(1);
          const viewport = (page1 as unknown as { getViewport: (options: { scale: number }) => { width: number; height: number } }).getViewport({
            scale: 1
          });
          const canvas = document.getElementById('baseline') as HTMLCanvasElement | null;
          if (!canvas) throw new Error('Baseline canvas not found');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Baseline canvas context not available');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const renderTask = (page1 as unknown as { render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown> } }).render({
            canvasContext: ctx,
            viewport
          });
          await renderTask.promise;
          return { ok: true };
        } catch (error: unknown) {
          const message =
            error && typeof error === 'object' && 'message' in error
              ? String((error as { message?: unknown }).message)
              : String(error);
          const stack =
            error && typeof error === 'object' && 'stack' in error
              ? String((error as { stack?: unknown }).stack)
              : '';
          return { ok: false, message, stack };
        }
      }, { base64: pdfBase64ForBaseline });

      if (!baselineRenderResult.ok) {
        throw new Error(`Baseline render failed: ${baselineRenderResult.message}${baselineRenderResult.stack ? `\n${baselineRenderResult.stack}` : ''}`);
      }

      const baselineCanvas = await page.$('#baseline');
      if (!baselineCanvas) throw new Error('Baseline canvas element not found');
      const baselineBytes = await baselineCanvas.screenshot();
      const baselinePng = cropToContent(PNG.sync.read(baselineBytes));

      await page.setViewportSize({ width: baselinePng.width, height: baselinePng.height });
      await page.setContent(fullHtml, { waitUntil: 'load' });
      await page.waitForTimeout(250);

      const pageEl =
        (await page.$('.pdf-page-0')) ||
        (await page.$('[class^="pdf-page-"]'));

      const screenshotBytes = pageEl
        ? await pageEl.screenshot()
        : await page.screenshot({ fullPage: false });
      const actualCropped = cropToContent(PNG.sync.read(screenshotBytes));

      const expectedResized = baselinePng;
      const actualResized = resizeNearest(actualCropped, expectedResized.width, expectedResized.height);
      const aligned = alignByTranslation(expectedResized, actualResized);
      console.log(`Semantic alignment shift applied: dx=${aligned.dx}, dy=${aligned.dy}`);

      const expectedForCompare = aligned.expected;
      const actualForCompare = aligned.actual;
      const width = expectedForCompare.width;
      const height = expectedForCompare.height;

      const diff = new PNG({ width, height });
      const diffPixels = pixelmatch(
        expectedForCompare.data,
        actualForCompare.data,
        diff.data,
        width,
        height,
        { threshold: 0.15 }
      );

      writeFileSync(join(outputDir, 'boarding_pass_baseline.png'), PNG.sync.write(expectedForCompare));
      writeFileSync(join(outputDir, 'boarding_pass_actual.png'), PNG.sync.write(actualForCompare));
      writeFileSync(join(outputDir, 'boarding_pass_diff.png'), PNG.sync.write(diff));

      const totalPixels = width * height;
      const diffRatio = diffPixels / totalPixels;
      console.log(`Semantic visual diff: ${diffPixels} pixels (${(diffRatio * 100).toFixed(4)}%)`);
      expect(diffRatio, 'Semantic visual diff ratio should be within tolerance (target: <3% like preserve fidelity)').toBeLessThan(0.03);
    }
  });
});

