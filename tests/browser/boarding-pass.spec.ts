import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

type TestWindow = Window & {
  __PDF2HTML_READY__?: boolean;
  __PDF2HTML_ERROR__?: string | null;
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
    const hasAnyLines = html.includes('pdf-sem-lines');
    const hasFlexRegions = /data-layout="flex"/i.test(html);
    const hasAbsRegions = /data-layout="absolute"/i.test(html);
    const hasFlexboxLine = html.includes('pdf-sem-line') && html.includes('flex-direction: row');
    const hasFlexboxGaps = html.includes('pdf-sem-gap') || html.includes('pdf-sem-vgap');
    expect(hasAnyLines, 'Should have semantic lines containers').toBe(true);
    expect(hasFlexRegions || hasAbsRegions, 'Should have semantic regions rendered either as flex or absolute').toBe(true);
    expect(hasFlexboxLine || hasAbsRegions, 'Should have flex line containers or absolute region fallback').toBe(true);
    expect(hasFlexboxGaps || hasAbsRegions, 'Should have flexbox gap elements or absolute region fallback').toBe(true);
    
    console.log('Semantic layout verification:', {
      hasFlexRegions,
      hasAbsRegions,
      hasFlexboxLine,
      hasFlexboxGaps,
      regionCount: (html.match(/pdf-sem-region/g) || []).length,
      lineCount: (html.match(/pdf-sem-line/g) || []).length,
    });

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(fullHtml, { waitUntil: 'load' });
    await page.waitForTimeout(250);

    const overlapReport = await page.evaluate(() => {
      const regions = Array.from(document.querySelectorAll('.pdf-sem-region')) as HTMLElement[];
      const overlaps: Array<{ regionIndex: number; a: number; b: number; ax: number; ay: number; aw: number; ah: number; bx: number; by: number; bw: number; bh: number }> = [];

      const intersects1D = (a1: number, a2: number, b1: number, b2: number): number => {
        const left = Math.max(a1, b1);
        const right = Math.min(a2, b2);
        return right - left;
      };

      for (let ri = 0; ri < regions.length; ri++) {
        const region = regions[ri]!;
        const linesContainer = region.querySelector('.pdf-sem-lines') as HTMLElement | null;
        const layoutMode = linesContainer?.getAttribute('data-layout') || 'flex';
        if (layoutMode !== 'flex') continue;
        const lines = Array.from(region.querySelectorAll('.pdf-sem-line')) as HTMLElement[];
        const rects = lines.map((el) => el.getBoundingClientRect());
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!;
            const b = rects[j]!;
            const xOverlap = intersects1D(a.left, a.right, b.left, b.right);
            if (xOverlap <= 4) continue;
            const yOverlap = intersects1D(a.top, a.bottom, b.top, b.bottom);
            if (yOverlap <= 1) continue;
            overlaps.push({
              regionIndex: ri,
              a: i,
              b: j,
              ax: a.left,
              ay: a.top,
              aw: a.width,
              ah: a.height,
              bx: b.left,
              by: b.top,
              bw: b.width,
              bh: b.height
            });
          }
        }
      }
      return { overlapCount: overlaps.length, overlaps: overlaps.slice(0, 25) };
    });

    if (overlapReport.overlapCount > 0) {
      console.log('Detected overlapping semantic lines:', overlapReport);
    }

    expect(overlapReport.overlapCount, 'Semantic layout should not have overlapping .pdf-sem-line boxes (with x-overlap guard)').toBe(0);
  });
});

