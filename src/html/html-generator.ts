import type {
  HTMLOutput,
  HTMLGenerationOptions,
  CSSOptions,
  OutputMetadata
} from '../types/output.js';
import type { PDFDocument, PDFPage, PDFGraphicsContent, PDFFormContent, PDFAnnotation } from '../types/pdf.js';
import type { FontMapping } from '../types/fonts.js';
import { CSSGenerator } from './css-generator.js';
import { LayoutEngine } from './layout-engine.js';

export class HTMLGenerator {
  private cssGenerator: CSSGenerator;
  private layoutEngine: LayoutEngine;
  private options: HTMLGenerationOptions;

  constructor(
    options: HTMLGenerationOptions,
    cssOptions: CSSOptions = { includeFonts: true, includeReset: true, includePrint: true }
  ) {
    this.options = options;
    this.cssGenerator = new CSSGenerator(options, cssOptions);
    this.layoutEngine = new LayoutEngine(options);
  }

  generate(
    document: PDFDocument,
    fontMappings: FontMapping[],
    metadata: OutputMetadata
  ): HTMLOutput {
    const html = this.generateHTML(document, fontMappings);
    const css = this.generateCSS(fontMappings, document.pages);
    const fonts = this.extractFontFamilies(fontMappings);

    return {
      html: this.formatOutput(html, css),
      css,
      metadata,
      fonts
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

    // Generate text content
    for (const text of page.content.text) {
      const fontClass = this.getFontClass(text.fontFamily, fontMappings);
      parts.push(this.layoutEngine.generateTextElement(text, page.height, fontClass));
    }

    // Generate images
    for (const image of page.content.images) {
      parts.push(this.layoutEngine.generateImageElement(image, page.height, this.options.baseUrl));
    }

    // Generate graphics (SVG/vector elements)
    if (page.content.graphics.length > 0) {
      parts.push(this.generateGraphicsSVG(page.content.graphics, page.width, page.height));
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
    return this.cssGenerator.generate(fontMappings, pages);
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
}
