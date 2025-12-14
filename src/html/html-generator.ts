import type {
  HTMLOutput,
  HTMLGenerationOptions,
  CSSOptions,
  OutputMetadata
} from '../types/output.js';
import type { PDFDocument, PDFPage, PDFGraphicsContent, PDFFormContent, PDFAnnotation, PDFTextContent } from '../types/pdf.js';
import type { FontMapping } from '../types/fonts.js';
import { CSSGenerator } from './css-generator.js';
import { LayoutEngine } from './layout-engine.js';
import { RegionLayoutAnalyzer } from '../core/region-layout.js';

type LineToken =
  | { type: 'text'; text: string; sample: PDFTextContent }
  | { type: 'space' };

export class HTMLGenerator {
  private cssGenerator: CSSGenerator;
  private layoutEngine: LayoutEngine;
  private options: HTMLGenerationOptions;
  private regionLayoutAnalyzer: RegionLayoutAnalyzer;
  private extraCssRules: string[] = [];
  private flowStyleClassByKey: Map<string, string> = new Map();
  private absGapCssInjected: boolean = false;

  constructor(
    options: HTMLGenerationOptions,
    cssOptions: CSSOptions = { includeFonts: true, includeReset: true, includePrint: true }
  ) {
    this.options = options;
    this.cssGenerator = new CSSGenerator(options, cssOptions);
    this.layoutEngine = new LayoutEngine(options);
    this.regionLayoutAnalyzer = new RegionLayoutAnalyzer({
      textPipeline: options.textPipeline ?? 'legacy',
      textClassifierProfile: options.textClassifierProfile
    });
  }

  generate(
    document: PDFDocument,
    fontMappings: FontMapping[],
    metadata: OutputMetadata
  ): HTMLOutput {
    this.extraCssRules = [];
    this.flowStyleClassByKey.clear();
    this.absGapCssInjected = false;
    this.layoutEngine.resetCssCaches();

    const html = this.generateHTML(document, fontMappings);
    const css = this.generateCSS(fontMappings, document.pages);
    const fonts = this.extractFontFamilies(fontMappings);
    const text = this.options.includeExtractedText ? this.extractDocumentText(document) : undefined;

    return {
      html: this.formatOutput(html, css),
      css,
      metadata,
      fonts,
      text
    };
  }

  private generateHTML(
    document: PDFDocument,
    fontMappings: FontMapping[]
  ): string {
    const parts: string[] = [];

    parts.push('<!DOCTYPE html>');
    parts.push('<html lang="en">');
    parts.push('<head>');
    parts.push('<meta charset="UTF-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    parts.push(`<title>${document.metadata.title || 'PDF Document'}</title>`);

    if (this.options.format === 'html+css') {
      parts.push('<link rel="stylesheet" href="styles.css">');
    } else if (this.options.format === 'html+inline-css') {
      // CSS will be inlined in formatOutput
    }

    parts.push('</head>');
    parts.push('<body>');
    parts.push('<div class="pdf-content">');

    // Ensure all pages are included, even if empty
    if (document.pages.length !== document.pageCount) {
      console.warn(`Page count mismatch: expected ${document.pageCount} pages, but document.pages has ${document.pages.length} pages`);
    }

    for (let i = 0; i < document.pageCount; i++) {
      const page = document.pages[i];
      if (!page) {
        console.error(`Page ${i} is missing from document.pages array`);
        // Create a placeholder page to maintain page numbering
        const placeholderPage: PDFPage = {
          pageNumber: i,
          width: 612, // Standard US Letter width
          height: 792, // Standard US Letter height
          content: {
            text: [],
            images: [],
            graphics: [],
            forms: [],
            annotations: []
          }
        };
        parts.push(this.generatePageHTML(placeholderPage, fontMappings));
      } else {
        parts.push(this.generatePageHTML(page, fontMappings));
      }
    }

    parts.push('</div>');
    parts.push('</body>');
    parts.push('</html>');

    return parts.join('\n');
  }

  private generateSvgTextLayer(page: PDFPage, fontMappings: FontMapping[]): string {
    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const out: string[] = [];
    out.push(
      `<svg class="pdf-text-layer" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" style="position: absolute; left: 0; top: 0; width: ${page.width}px; height: ${page.height}px; overflow: visible; pointer-events: none;">`
    );

    for (const region of analysis.regions) {
      for (const line of region.lines) {
        const mergedRuns = this.mergeTextRuns(line.items);
        for (const run of mergedRuns) {
          const fontClass = this.getFontClass(run.fontFamily, fontMappings);
          out.push(this.layoutEngine.generateSvgTextElement(run, page.height, fontClass));
        }
      }
    }

    out.push('</svg>');
    return out.join('\n');
  }

  private generatePageHTML(
    page: PDFPage,
    fontMappings: FontMapping[]
  ): string {
    const parts: string[] = [];

    const pageClass = this.options.preserveLayout
      ? `pdf-page pdf-page-${page.pageNumber}`
      : 'pdf-page';

    const pageStyle = this.options.preserveLayout
      ? `style="position: relative; width: ${page.width}px; height: ${page.height}px; margin: 0 auto; background: white;"`
      : 'style="position: relative; width: 100%; max-width: 100%; background: white;"';

    parts.push(`<div class="${pageClass}" ${pageStyle}>`);

    // Generate graphics (SVG/vector elements) first so text/images can render on top
    if (page.content.graphics.length > 0) {
      parts.push(this.generateGraphicsSVG(page.content.graphics, page.width, page.height));
    }

    // Generate images (render above vector backgrounds)
    for (const image of page.content.images) {
      parts.push(this.layoutEngine.generateImageElement(image, page.height, this.options.baseUrl));
    }

    const useSvgText = this.options.preserveLayout && this.options.textRenderMode === 'svg';

    if (useSvgText) {
      parts.push(this.generateSvgTextLayer(page, fontMappings));
    } else if (this.options.preserveLayout && this.options.textLayout === 'smart') {
      parts.push(this.generateSmartText(page, fontMappings));
    } else {
      if (this.options.preserveLayout) {
        const analysis = this.regionLayoutAnalyzer.analyze(page);
        for (const region of analysis.regions) {
          for (const line of region.lines) {
            const mergedRuns = this.mergeTextRuns(line.items);
            for (const run of mergedRuns) {
              const fontClass = this.getFontClass(run.fontFamily, fontMappings);
              parts.push(this.layoutEngine.generateTextElement(run, page.height, fontClass));
            }
          }
        }
      } else {
        for (const text of page.content.text) {
          const fontClass = this.getFontClass(text.fontFamily, fontMappings);
          parts.push(this.layoutEngine.generateTextElement(text, page.height, fontClass));
        }
      }
    }

    // Generate forms (if any)
    if (page.content.forms.length > 0) {
      for (const form of page.content.forms) {
        parts.push(this.generateFormElement(form, page.height));
      }
    }

    // Generate annotations (if any)
    if (page.content.annotations.length > 0) {
      for (const annotation of page.content.annotations) {
        parts.push(this.generateAnnotationElement(annotation, page.height));
      }
    }

    parts.push('</div>');

    return parts.join('\n');
  }

  private generateSmartText(page: PDFPage, fontMappings: FontMapping[]): string {
    const items = page.content.text;
    if (!items || items.length === 0) return '';

    const nonEmpty = items.filter((t) => t.text && t.text.trim().length > 0);
    if (nonEmpty.length === 0) return '';

    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const passes = this.options.textLayoutPasses ?? 1;

    const html: string[] = [];

    for (const region of analysis.regions) {
      const width = Math.max(0, region.rect.width);
      const height = Math.max(0, region.rect.height);

      if (!region.flowAllowed) {
        html.push(
          `<div class="pdf-abs-region" style="position: absolute; left: ${region.rect.left}px; top: ${region.rect.top}px; width: ${width}px; height: ${height}px;" data-x="${region.rect.left}" data-top="${region.rect.top}" data-width="${width}" data-height="${height}">`
        );

        for (const line of region.lines) {
          const lineTop = Math.max(0, Math.round((line.rect.top - region.rect.top) * 1000) / 1000);
          const lineHeight = Math.max(1, Math.round(line.rect.height * 1000) / 1000);
          const mergedRuns = this.mergeTextRuns(line.items);

          const canRelativeRebuild =
            passes >= 2 &&
            !line.hasRotation &&
            (() => {
              if (mergedRuns.length <= 1) return false;
              const fs = mergedRuns.map((t) => t.fontSize);
              const minFs = Math.min(...fs);
              const maxFs = Math.max(...fs);
              if (maxFs - minFs > 1.75) return false;

              const alphaNumRuns = mergedRuns.filter((t) => /[A-Za-z0-9]/.test(t.text));
              const ys = (alphaNumRuns.length > 0 ? alphaNumRuns : mergedRuns).map((t) => t.y);
              const ySpread = Math.max(...ys) - Math.min(...ys);
              const yTol = Math.max(1.5, Math.min(lineHeight, ((minFs + maxFs) / 2) * 0.35));
              if (ySpread > yTol) return false;

              let overlaps = 0;
              let cursor = -Infinity;
              for (const run of mergedRuns) {
                const start = run.x;
                if (Number.isFinite(cursor) && start < cursor - 0.75) overlaps++;
                cursor = Math.max(cursor, start + Math.max(0, run.width));
              }

              return overlaps <= Math.max(0, Math.floor(mergedRuns.length / 5));
            })();

          if (canRelativeRebuild) {
            if (!this.absGapCssInjected) {
              this.extraCssRules.push('.pdf-abs-gap { display: inline-block; font-size: 0; line-height: 0; }');
              this.absGapCssInjected = true;
            }
            html.push(
              `<div class="pdf-abs-line" style="position: absolute; left: 0; top: ${lineTop}px; width: ${width}px; height: ${lineHeight}px; white-space: pre; line-height: ${lineHeight}px;">`
            );

            let cursorX = 0;
            for (const run of mergedRuns) {
              const fontClass = this.getFontClass(run.fontFamily, fontMappings);
              const xRel = run.x - region.rect.left;
              const gap = xRel - cursorX;
              if (gap > 0.5) {
                const w = Math.round(gap * 1000) / 1000;
                html.push(`<span class="pdf-abs-gap" style="width: ${w}px"></span>`);
              }
              html.push(this.layoutEngine.generateInlineTextSpan(run, fontClass));
              cursorX = Math.max(cursorX, xRel + Math.max(0, run.width));
            }

            html.push('</div>');
          } else {
            html.push(
              `<div class="pdf-abs-line" style="position: absolute; left: 0; top: ${lineTop}px; width: ${width}px; height: ${lineHeight}px;">`
            );

            for (const run of mergedRuns) {
              const fontClass = this.getFontClass(run.fontFamily, fontMappings);
              const abs = this.layoutEngine.transformCoordinates(run.x, run.y, page.height, run.height);
              const rel = {
                x: abs.x - region.rect.left,
                y: abs.y - region.rect.top - lineTop
              };
              html.push(this.layoutEngine.generateTextElement(run, page.height, fontClass, { coordsOverride: rel }));
            }

            html.push('</div>');
          }
        }

        html.push('</div>');
        continue;
      }

      html.push(
        `<div class="pdf-text-region" style="position: absolute; left: ${region.rect.left}px; top: ${region.rect.top}px; width: ${width}px; height: ${height}px;" data-x="${region.rect.left}" data-top="${region.rect.top}" data-width="${width}" data-height="${height}" data-obstacle-distance="${Math.round(region.nearestObstacleDistance * 100) / 100}">`
      );

      for (const paragraph of region.paragraphs) {
        const dominant = paragraph.dominant;
        const fontClass = this.getFontClass(dominant.fontFamily, fontMappings);
        const lineHeight = Math.max(1, Math.round(paragraph.lineHeight * 1000) / 1000);
        const flowStyle: Record<string, string> = {
          position: 'relative',
          'white-space': 'normal',
          'line-height': `${lineHeight}px`,
          ...(passes >= 2 ? {} : { 'font-size': `${dominant.fontSize}px`, color: dominant.color })
        };
        if (passes < 2) {
          if (dominant.fontWeight && dominant.fontWeight !== 400) flowStyle['font-weight'] = String(dominant.fontWeight);
          if (dominant.fontStyle && dominant.fontStyle !== 'normal') flowStyle['font-style'] = dominant.fontStyle;
        }

        const flowClass = this.getFlowStyleClass(flowStyle);

        const mt = Math.max(0, Math.round(paragraph.gapBefore * 1000) / 1000);
        const indents = paragraph.lines.map((l) => l.indent);
        const minIndent = indents.length > 0 ? Math.max(0, Math.round(Math.min(...indents) * 1000) / 1000) : 0;
        const firstIndent = indents.length > 0 ? Math.max(0, Math.round(indents[0] * 1000) / 1000) : 0;
        const textIndent = Math.round((firstIndent - minIndent) * 1000) / 1000;

        const inlineParts: string[] = [];
        if (mt > 0) inlineParts.push(`margin-top: ${mt}px`);
        if (minIndent > 0) inlineParts.push(`padding-left: ${minIndent}px`);
        if (Math.abs(textIndent) > 0.01) inlineParts.push(`text-indent: ${textIndent}px`);
        const inlineStyle = inlineParts.length > 0 ? ` style="${inlineParts.join('; ')}"` : '';

        let paragraphBody: string;

        if (passes >= 2) {
          const parts: string[] = [];

          for (let i = 0; i < paragraph.lines.length; i++) {
            const lineEntry = paragraph.lines[i];

            if (i > 0 && !lineEntry.joinWithPrev) {
              parts.push(' ');
            }

            const sourceLine = lineEntry.sourceLine;
            if (!sourceLine) {
              const fallback = (lineEntry.text || '').trim();
              if (fallback.length > 0) parts.push(this.escapeHtml(fallback));
              continue;
            }

            let tokens = this.regionLayoutAnalyzer.reconstructLineTokens(sourceLine.items) as LineToken[];
            const nextEntry = paragraph.lines[i + 1];
            if (nextEntry?.joinWithPrev === 'hyphenation') {
              tokens = this.stripTrailingSoftHyphen(tokens);
            }

            parts.push(this.renderTokens(tokens, fontMappings));
          }

          paragraphBody = parts.join('');
        } else {
          const mergedText = paragraph.lines
            .map((l) => (l.text || '').trim())
            .filter((t) => t.length > 0)
            .join(' ');
          paragraphBody = this.escapeHtml(mergedText);
        }

        html.push(`<p class="${fontClass} ${flowClass}"${inlineStyle}>${paragraphBody}</p>`);
      }

      html.push('</div>');
    }

    return html.join('\n');
  }

  private mergeTextRuns(items: PDFTextContent[]): PDFTextContent[] {
    return this.regionLayoutAnalyzer.mergeTextRuns(items);
  }

  private renderTokens(tokens: LineToken[], fontMappings: FontMapping[]): string {
    const out: string[] = [];
    for (const tok of tokens) {
      if (tok.type === 'space') {
        out.push(' ');
        continue;
      }

      const sample = tok.sample;
      const fontClass = this.getFontClass(sample.fontFamily, fontMappings);
      out.push(this.layoutEngine.generateInlineTextSpan({ ...sample, text: tok.text }, fontClass));
    }
    return out.join('');
  }

  private stripTrailingSoftHyphen(tokens: LineToken[]): LineToken[] {
    if (!tokens || tokens.length === 0) return tokens;
    const out = [...tokens];
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i];
      if (t.type === 'space') continue;
      if (!t.text) break;
      if (!t.text.endsWith('\u00AD')) break;

      const nextText = t.text.slice(0, -1);
      if (nextText.length === 0) {
        out.splice(i, 1);
      } else {
        out[i] = { ...t, text: nextText };
      }
      break;
    }
    return out;
  }

  private getFontClass(fontFamily: string, fontMappings: FontMapping[]): string {
    const mapping = fontMappings.find(m => m.detectedFont.family === fontFamily);
    if (mapping) {
      return `font-${mapping.googleFont.family.toLowerCase().replace(/\s+/g, '-')}`;
    }
    return 'font-default';
  }

  private generateFormElement(form: PDFFormContent, pageHeight: number): string {
    const coords = this.layoutEngine.transformCoordinates(form.x, form.y, pageHeight);
    const escapedValue = typeof form.value === 'string' 
      ? form.value.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      : String(form.value);
    const style = `position: absolute; left: ${coords.x}px; top: ${coords.y}px; width: ${form.width}px; height: ${form.height}px;`;
    
    switch (form.type) {
      case 'text':
        return `<input type="text" name="${form.name}" value="${escapedValue}" style="${style}" ${form.readonly ? 'readonly' : ''} />`;
      case 'checkbox':
        return `<input type="checkbox" name="${form.name}" ${form.value ? 'checked' : ''} style="${style}" />`;
      case 'radio':
        return `<input type="radio" name="${form.name}" ${form.value ? 'checked' : ''} style="${style}" />`;
      case 'button':
        return `<button name="${form.name}" style="${style}">${escapedValue}</button>`;
      case 'dropdown':
        return `<select name="${form.name}" style="${style}"><option>${escapedValue}</option></select>`;
      default:
        return '';
    }
  }

  private generateAnnotationElement(annotation: PDFAnnotation, pageHeight: number): string {
    const coords = this.layoutEngine.transformCoordinates(annotation.x, annotation.y, pageHeight);
    const style = `position: absolute; left: ${coords.x}px; top: ${coords.y}px; width: ${annotation.width}px; height: ${annotation.height}px;`;
    const escapedContent = annotation.content ? annotation.content.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    const escapedUrl = annotation.url ? annotation.url.replace(/"/g, '&quot;') : '';
    
    switch (annotation.type) {
      case 'link':
        return annotation.url 
          ? `<a href="${escapedUrl}" style="${style}">${escapedContent}</a>`
          : '';
      case 'note':
        return `<div class="annotation-note" style="${style}" title="${escapedContent}">📝</div>`;
      case 'highlight':
        return `<div class="annotation-highlight" style="${style}; background: yellow; opacity: 0.3;">${escapedContent}</div>`;
      case 'underline':
        return `<span class="annotation-underline" style="${style}; text-decoration: underline;">${escapedContent}</span>`;
      case 'strikeout':
        return `<span class="annotation-strikeout" style="${style}; text-decoration: line-through;">${escapedContent}</span>`;
      default:
        return '';
    }
  }

  private generateCSS(
    fontMappings: FontMapping[],
    pages: PDFPage[]
  ): string {
    const base = this.cssGenerator.generate(fontMappings, pages);
    const rules = [...this.layoutEngine.getExtraCssRules(), ...this.extraCssRules];
    if (rules.length === 0) return base;
    return [base, rules.join('\n\n')].join('\n\n');
  }

  private formatOutput(html: string, css: string): string {
    if (this.options.format === 'html+inline-css') {
      return html.replace(
        '</head>',
        `<style>${css}</style></head>`
      );
    }

    return html;
  }

  private extractFontFamilies(fontMappings: FontMapping[]): string[] {
    return Array.from(
      new Set(fontMappings.map((m) => m.googleFont.family))
    );
  }

  private extractDocumentText(document: PDFDocument): string {
    const pages: string[] = [];
    for (const page of document.pages) {
      const pageText = this.extractPageText(page);
      if (pageText) pages.push(pageText);
    }
    return pages.join('\n\n');
  }

  private extractPageText(page: PDFPage): string {
    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const regions = [...analysis.regions].sort((a, b) => {
      const yDiff = a.rect.top - b.rect.top;
      if (Math.abs(yDiff) > 0.5) return yDiff;
      return a.minX - b.minX;
    });

    const out: string[] = [];

    const mergeLineBreakContinuation = (a: string, b: string): { merged: string; joined: boolean } => {
      const aTrim = a.replace(/\s+$/g, '');
      const bTrim = b.replace(/^\s+/g, '');

      if (aTrim.length === 0 || bTrim.length === 0) {
        return { merged: aTrim, joined: false };
      }

      const aEndsWithShortCapPrefix = /[A-Z][a-z]{0,2}$/.test(aTrim);
      const bStartsLowerContinuation = /^[a-z]{3,}/.test(bTrim);
      const aEndsWithPunct = /(?:\]|\[|\)|\(|\}|\{|,|\.|;|:|!|\?)$/.test(aTrim);

      if (aEndsWithShortCapPrefix && bStartsLowerContinuation && !aEndsWithPunct) {
        return { merged: aTrim + bTrim, joined: true };
      }

      return { merged: aTrim, joined: false };
    };

    for (const region of regions) {
      if (region.flowAllowed && region.paragraphs.length > 0) {
        for (const paragraph of region.paragraphs) {
          const mergedText = paragraph.lines
            .map((l) => (l.text || '').trim())
            .filter((t) => t.length > 0)
            .join(' ');
          if (mergedText) out.push(mergedText);
        }
        continue;
      }

      const orderedLines = [...region.lines].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 0.5) return yDiff;
        return a.minX - b.minX;
      });

      for (const line of orderedLines) {
        const lineText = this.regionLayoutAnalyzer.reconstructLineText(line.items);
        if (!lineText) continue;
        const prev = out.length > 0 ? out[out.length - 1] : undefined;
        if (prev) {
          const merged = mergeLineBreakContinuation(prev, lineText);
          if (merged.joined) {
            out[out.length - 1] = merged.merged;
            continue;
          }
        }
        out.push(lineText);
      }
    }

    return out.join('\n');
  }

  private generateGraphicsSVG(
    graphics: PDFGraphicsContent[],
    pageWidth: number,
    pageHeight: number
  ): string {
    if (graphics.length === 0) {
      return '';
    }

    const parts: string[] = [];
    parts.push(`<svg width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}" class="pdf-graphics" style="position: absolute; top: 0; left: 0; pointer-events: none;">`);

    for (const graphic of graphics) {
      parts.push(this.generateGraphicElement(graphic));
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  private generateGraphicElement(graphic: PDFGraphicsContent): string {
    const attrs: string[] = [];

    if (graphic.stroke) {
      attrs.push(`stroke="${graphic.stroke}"`);
    }

    if (graphic.strokeOpacity !== undefined) {
      attrs.push(`stroke-opacity="${graphic.strokeOpacity}"`);
    }

    if (graphic.fill) {
      attrs.push(`fill="${graphic.fill}"`);
    } else {
      attrs.push('fill="none"');
    }

    if (graphic.fillRule) {
      attrs.push(`fill-rule="${graphic.fillRule}"`);
    }

    if (graphic.fillOpacity !== undefined) {
      attrs.push(`fill-opacity="${graphic.fillOpacity}"`);
    }

    if (graphic.strokeWidth) {
      attrs.push(`stroke-width="${graphic.strokeWidth}"`);
    }

    if (graphic.lineCap) {
      attrs.push(`stroke-linecap="${graphic.lineCap}"`);
    }

    if (graphic.lineJoin) {
      attrs.push(`stroke-linejoin="${graphic.lineJoin}"`);
    }

    const attrString = attrs.join(' ');

    switch (graphic.type) {
      case 'path':
        return graphic.path ? `<path d="${graphic.path}" ${attrString} />` : '';

      case 'rectangle':
        return graphic.x !== undefined && graphic.y !== undefined && graphic.width && graphic.height
          ? `<rect x="${graphic.x}" y="${graphic.y}" width="${graphic.width}" height="${graphic.height}" ${attrString} />`
          : '';

      case 'circle':
        return graphic.x !== undefined && graphic.y !== undefined && graphic.width
          ? `<circle cx="${graphic.x + graphic.width / 2}" cy="${graphic.y + graphic.width / 2}" r="${graphic.width / 2}" ${attrString} />`
          : '';

      case 'line':
        return graphic.x !== undefined && graphic.y !== undefined && graphic.width && graphic.height
          ? `<line x1="${graphic.x}" y1="${graphic.y}" x2="${graphic.x + graphic.width}" y2="${graphic.y + graphic.height}" ${attrString} />`
          : '';

      case 'curve':
        // For curves, we'll render as a path if available, otherwise skip
        return graphic.path ? `<path d="${graphic.path}" ${attrString} />` : '';

      case 'raster':
        return graphic.data && graphic.width && graphic.height
          ? `<image href="${graphic.data}" x="${graphic.x ?? 0}" y="${graphic.y ?? 0}" width="${graphic.width}" height="${graphic.height}" ${attrString} />`
          : '';

      default:
        return '';
    }
  }

  private escapeHtml(text: string): string {
    if (typeof document !== 'undefined') {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getFlowStyleClass(style: Record<string, string>): string {
    const entries = Object.entries(style)
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const key = entries.map(([k, v]) => `${k}:${v}`).join(';');

    const existing = this.flowStyleClassByKey.get(key);
    if (existing) return existing;

    const className = `pdf-flow-style-${this.flowStyleClassByKey.size}`;
    this.flowStyleClassByKey.set(key, className);

    const decls = entries.map(([k, v]) => `  ${k}: ${v};`).join('\n');
    this.extraCssRules.push(`.${className} {\n${decls}\n}`);
    return className;
  }
}
