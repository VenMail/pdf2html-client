import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const demopdfsDir = join(__dirname, '../../demo/demopdfs');
const outputRoot = join(__dirname, '../../test-results/demopdfs-fidelity');

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

type Pdf2HtmlOutput = {
  html: string;
  css: string;
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

const downscaleForAlignment = (png: PNG, maxDim: number): { png: PNG; scaleX: number; scaleY: number } => {
  const maxSide = Math.max(png.width, png.height);
  if (maxSide <= maxDim) {
    return { png, scaleX: 1, scaleY: 1 };
  }
  const scale = maxDim / maxSide;
  const w = Math.max(1, Math.round(png.width * scale));
  const h = Math.max(1, Math.round(png.height * scale));
  const resized = resizeNearest(png, w, h);
  return {
    png: resized,
    scaleX: png.width / resized.width,
    scaleY: png.height / resized.height
  };
};

const alignByTranslation = (
  expected: PNG,
  actual: PNG
): { expected: PNG; actual: PNG; dx: number; dy: number } => {
  const maxDx = 20;
  const maxDy = 20;
  const step = 2;

  const { png: expThumb, scaleX: expScaleX, scaleY: expScaleY } = downscaleForAlignment(expected, 320);
  const { png: actThumb, scaleX: actScaleX, scaleY: actScaleY } = downscaleForAlignment(actual, 320);

  let bestDx = 0;
  let bestDy = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  const scoreAt = (dx: number, dy: number): number => {
    const width = Math.min(
      expThumb.width,
      actThumb.width - Math.max(0, dx),
      expThumb.width + Math.min(0, dx)
    );
    const height = Math.min(
      expThumb.height,
      actThumb.height - Math.max(0, dy),
      expThumb.height + Math.min(0, dy)
    );
    if (width <= 50 || height <= 50) return Number.POSITIVE_INFINITY;

    const expCrop = new PNG({ width, height });
    const actCrop = new PNG({ width, height });

    const expSrcX = dx < 0 ? -dx : 0;
    const expSrcY = dy < 0 ? -dy : 0;
    const actSrcX = dx > 0 ? dx : 0;
    const actSrcY = dy > 0 ? dy : 0;

    PNG.bitblt(expThumb, expCrop, expSrcX, expSrcY, width, height, 0, 0);
    PNG.bitblt(actThumb, actCrop, actSrcX, actSrcY, width, height, 0, 0);

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

  const scaledDx = Math.round(bestDx * ((expScaleX + actScaleX) / 2));
  const scaledDy = Math.round(bestDy * ((expScaleY + actScaleY) / 2));

  const width = Math.min(
    expected.width,
    actual.width - Math.max(0, scaledDx),
    expected.width + Math.min(0, scaledDx)
  );
  const height = Math.min(
    expected.height,
    actual.height - Math.max(0, scaledDy),
    expected.height + Math.min(0, scaledDy)
  );

  const expAligned = new PNG({ width, height });
  const actAligned = new PNG({ width, height });
  const expSrcX = scaledDx < 0 ? -scaledDx : 0;
  const expSrcY = scaledDy < 0 ? -scaledDy : 0;
  const actSrcX = scaledDx > 0 ? scaledDx : 0;
  const actSrcY = scaledDy > 0 ? scaledDy : 0;
  PNG.bitblt(expected, expAligned, expSrcX, expSrcY, width, height, 0, 0);
  PNG.bitblt(actual, actAligned, actSrcX, actSrcY, width, height, 0, 0);

  return { expected: expAligned, actual: actAligned, dx: scaledDx, dy: scaledDy };
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
  <title>Converted</title>
  ${css ? `<style>${css}</style>` : ''}
</head>
<body>
  ${html}
</body>
</html>`;
};

const listDemoPdfs = (): string[] => {
  const entries = readdirSync(demopdfsDir);
  return entries
    .filter((f) => extname(f).toLowerCase() === '.pdf')
    .sort((a, b) => a.localeCompare(b));
};

type FidelitySummaryRow = {
  fileName: string;
  pageCount: number;
  pagesTested: number;
  best: {
    layout: 'absolute' | 'smart';
    diffRatio: number;
    fidelityPct: number;
  };
  absolute: {
    diffRatio: number;
    fidelityPct: number;
    spanCount: number;
    absSpanCount: number;
  };
  smart: {
    diffRatio: number;
    fidelityPct: number;
    spanCount: number;
    absSpanCount: number;
    blockCount: number;
  };
  outputDir: string;
};

const summary: FidelitySummaryRow[] = [];

test.describe.serial('Demo PDFs Fidelity', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`Browser Error: ${msg.text()}`);
      }
    });

    page.on('pageerror', (error) => {
      console.log(`Page error: ${error.message}`);
    });

    await page.goto('/test-harness.html', { waitUntil: 'networkidle' });

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

  const pdfFiles = listDemoPdfs();
  for (const fileName of pdfFiles) {
    test(`visual fidelity: ${fileName}`, async ({ page }) => {
      const pdfPath = join(demopdfsDir, fileName);
      const pdfBuffer = readFileSync(pdfPath);

      const base64 = pdfBuffer.toString('base64');
      const pdfDataUrl = `data:application/pdf;base64,${base64}`;
      const pdfBase64ForBaseline = base64;

      const baseOutputDir = join(outputRoot, basename(fileName, '.pdf'));
      mkdirSync(baseOutputDir, { recursive: true });

      const runForLayout = async (layout: 'absolute' | 'smart') => {
        const result = await page.evaluate(async ({ pdfData, layout }) => {
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
                darkMode: false,
                textLayout: layout,
              },
            });

            const startTime = performance.now();
            const output = (await converter.convert(arrayBuffer)) as Pdf2HtmlOutput;
            const processingTime = performance.now() - startTime;

            converter.dispose();

            const textContent = output.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

            return {
              ok: true,
              processingTime: Math.round(processingTime),
              pageCount: output.metadata.pageCount,
              html: output.html,
              css: output.css,
              textContent,
            };
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
        }, { pdfData: pdfDataUrl, layout });

        expect(result.ok, (result as unknown as { message?: string }).message || 'Conversion should succeed').toBe(true);

        const html = (result as unknown as { html: string }).html;
        const css = (result as unknown as { css: string }).css;
        const pageCount = (result as unknown as { pageCount: number }).pageCount;
        const fullHtml = buildRenderableHtml(html, css);

        const spanCount = (html.match(/<span\b/g) || []).length;
        const absSpanCount = (html.match(/position:\s*absolute/g) || []).length;
        const blockCount = (html.match(/class="pdf-text-block"/g) || []).length;

        return {
          pageCount,
          fullHtml,
          spanCount,
          absSpanCount,
          blockCount,
        };
      };

      const baselineForPage = async (pageNumber: number): Promise<PNG> => {
        await page.setContent('<!doctype html><html><body><canvas id="baseline"></canvas></body></html>', {
          waitUntil: 'load'
        });

        const baselineRenderResult = await page.evaluate(async ({ base64, pageNumber }) => {
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
            const pageObj = await doc.getPage(pageNumber);
            const viewport = (pageObj as unknown as { getViewport: (options: { scale: number }) => { width: number; height: number } }).getViewport({
              scale: 1
            });
            const canvas = document.getElementById('baseline') as HTMLCanvasElement | null;
            if (!canvas) throw new Error('Baseline canvas not found');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Baseline canvas context not available');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const renderTask = (pageObj as unknown as { render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown> } }).render({
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
        }, { base64: pdfBase64ForBaseline, pageNumber });

        if (!baselineRenderResult.ok) {
          throw new Error(`Baseline render failed: ${baselineRenderResult.message}${baselineRenderResult.stack ? `\n${baselineRenderResult.stack}` : ''}`);
        }

        const baselineCanvas = await page.$('#baseline');
        if (!baselineCanvas) throw new Error('Baseline canvas element not found');
        const baselineBytes = await baselineCanvas.screenshot();
        return cropToContent(PNG.sync.read(baselineBytes));
      };

      const scoreLayout = async (layout: 'absolute' | 'smart') => {
        const run = await runForLayout(layout);
        const layoutDir = join(baseOutputDir, layout);
        mkdirSync(layoutDir, { recursive: true });
        writeFileSync(join(layoutDir, 'converted.html'), run.fullHtml, 'utf8');

        const pagesToTest = Math.min(2, Math.max(1, run.pageCount));

        let totalDiffPixels = 0;
        let totalPixels = 0;
        let firstDx = 0;
        let firstDy = 0;

        for (let pageNumber = 1; pageNumber <= pagesToTest; pageNumber++) {
          const baselinePng = await baselineForPage(pageNumber);

          await page.setViewportSize({ width: baselinePng.width, height: baselinePng.height });
          await page.setContent(run.fullHtml, { waitUntil: 'load' });
          await page.waitForTimeout(250);

          const pageEl = (await page.$(`.pdf-page-${pageNumber - 1}`)) || (await page.$('.pdf-page-0')) || (await page.$('[class^="pdf-page-"]'));
          const imgEls = (
            (await page.$$(`.pdf-page-${pageNumber - 1} img`)) ||
            (await page.$$('.pdf-page-0 img')) ||
            (await page.$$('[class^="pdf-page-"] img'))
          );

          let useFullPageImage = false;
          let bestImgEl: (typeof imgEls)[number] | null = null;
          let bestArea = 0;
          const pageBox = pageEl ? await pageEl.boundingBox() : null;
          const pageArea = pageBox ? pageBox.width * pageBox.height : 0;

          for (const el of imgEls) {
            const box = await el.boundingBox();
            if (!box) continue;
            const area = box.width * box.height;
            if (area > bestArea) {
              bestArea = area;
              bestImgEl = el;
            }
          }

          if (pageArea > 0 && bestImgEl && bestArea / pageArea > 0.7) {
            useFullPageImage = true;
          }

          const screenshotBytes = pageEl
            ? (useFullPageImage && bestImgEl ? await bestImgEl.screenshot() : await pageEl.screenshot())
            : await page.screenshot({ fullPage: false });
          const actualCropped = cropToContent(PNG.sync.read(screenshotBytes));

          const actualResized = resizeNearest(actualCropped, baselinePng.width, baselinePng.height);
          const aligned = alignByTranslation(baselinePng, actualResized);

          if (pageNumber === 1) {
            firstDx = aligned.dx;
            firstDy = aligned.dy;
          }

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

          writeFileSync(join(layoutDir, `baseline_p${pageNumber}.png`), PNG.sync.write(expectedForCompare));
          writeFileSync(join(layoutDir, `actual_p${pageNumber}.png`), PNG.sync.write(actualForCompare));
          writeFileSync(join(layoutDir, `diff_p${pageNumber}.png`), PNG.sync.write(diff));

          totalDiffPixels += diffPixels;
          totalPixels += width * height;
        }

        const diffRatio = totalPixels > 0 ? totalDiffPixels / totalPixels : 1;
        const fidelityPct = (1 - diffRatio) * 100;
        return {
          diffRatio,
          fidelityPct,
          pagesTested: pagesToTest,
          dx: firstDx,
          dy: firstDy,
          spanCount: run.spanCount,
          absSpanCount: run.absSpanCount,
          blockCount: run.blockCount,
        };
      };

      const abs = await scoreLayout('absolute');
      const smart = await scoreLayout('smart');

      const best = abs.diffRatio <= smart.diffRatio
        ? { layout: 'absolute' as const, diffRatio: abs.diffRatio, fidelityPct: abs.fidelityPct }
        : { layout: 'smart' as const, diffRatio: smart.diffRatio, fidelityPct: smart.fidelityPct };

      const pagesTested = Math.max(abs.pagesTested, smart.pagesTested);

      console.log(
        `[${fileName}] pages=${Math.max(0, abs.pagesTested)} best=${best.layout} ` +
          `abs=${(abs.diffRatio * 100).toFixed(2)}% smart=${(smart.diffRatio * 100).toFixed(2)}% out=${baseOutputDir}`
      );

      summary.push({
        fileName,
        pageCount: Math.max(0, (await runForLayout('absolute')).pageCount),
        pagesTested,
        best,
        absolute: {
          diffRatio: abs.diffRatio,
          fidelityPct: abs.fidelityPct,
          spanCount: abs.spanCount,
          absSpanCount: abs.absSpanCount,
        },
        smart: {
          diffRatio: smart.diffRatio,
          fidelityPct: smart.fidelityPct,
          spanCount: smart.spanCount,
          absSpanCount: smart.absSpanCount,
          blockCount: smart.blockCount,
        },
        outputDir: baseOutputDir,
      });

      expect(best.diffRatio, 'Visual diff ratio should be reasonable').toBeLessThan(0.35);
    });
  }

  test.afterAll(() => {
    mkdirSync(outputRoot, { recursive: true });
    const sorted = [...summary].sort((a, b) => b.diffRatio - a.diffRatio);
    writeFileSync(join(outputRoot, 'summary.json'), JSON.stringify(sorted, null, 2), 'utf8');
  });
});
