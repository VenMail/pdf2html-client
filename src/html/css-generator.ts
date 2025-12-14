import type { CSSOptions, HTMLGenerationOptions } from '../types/output.js';
import type { FontMapping } from '../types/fonts.js';
import type { PDFPage } from '../types/pdf.js';

export class CSSGenerator {
  private options: HTMLGenerationOptions;
  private cssOptions: CSSOptions;

  constructor(
    options: HTMLGenerationOptions,
    cssOptions: CSSOptions = { includeFonts: true, includeReset: true, includePrint: true }
  ) {
    const defaults = { includeFonts: true, includeReset: true, includePrint: true };
    this.options = options;
    this.cssOptions = { ...defaults, ...cssOptions };
  }

  generate(fontMappings: FontMapping[], pages: PDFPage[]): string {
    const styles: string[] = [];

    if (this.cssOptions.includeReset) {
      styles.push(this.generateReset());
    }

    if (this.cssOptions.includeFonts) {
      styles.push(this.generateFontImports(fontMappings));
      styles.push(this.generateFontRules(fontMappings));
    }

    styles.push(this.generateBaseStyles());
    styles.push(this.generatePageStyles(pages));

    if (this.options.darkMode) {
      styles.push(this.generateDarkModeStyles());
    }

    if (this.cssOptions.includePrint) {
      styles.push(this.generatePrintStyles());
    }

    if (this.cssOptions.customStyles) {
      styles.push(this.cssOptions.customStyles);
    }

    return styles.join('\n\n');
  }

  private generateReset(): string {
    return `
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #fff;
}

.font-default {
  font-family: Arial, Helvetica, sans-serif;
}
`;
  }

  private generateFontImports(fontMappings: FontMapping[]): string {
    const uniqueFonts = new Set(
      fontMappings.map((m) => m.googleFont.family)
    );

    const imports: string[] = [];

    for (const fontFamily of uniqueFonts) {
      const mapping = fontMappings.find((m) => m.googleFont.family === fontFamily);
      if (mapping) {
        const variants = [mapping.variant];
        const fontUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
          fontFamily
        )}:wght@${variants.join(';')}&display=swap`;
        imports.push(`@import url('${fontUrl}');`);
      }
    }

    return imports.join('\n');
  }

  private generateFontRules(fontMappings: FontMapping[]): string {
    const rules: string[] = [];

    for (const mapping of fontMappings) {
      const fallback = mapping.fallbackChain.join(', ');
      const fontClass = this.getFontClass(mapping.googleFont.family);

      rules.push(`
.${fontClass} {
  font-family: '${mapping.googleFont.family}', ${fallback};
}
`);
    }

    return rules.join('\n');
  }

  private toFontClassSuffix(name: string): string {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  private generateBaseStyles(): string {
    if (this.options.preserveLayout) {
      return `
.pdf-content {
  margin: 0;
  padding: 0;
}

${this.options.responsive ? this.generateResponsiveStyles() : ''}
`;
    }
    return `
.pdf-content {
  max-width: 100%;
  margin: 0 auto;
  padding: 20px;
}

${this.options.responsive ? this.generateResponsiveStyles() : ''}
`;
  }

  private generateResponsiveStyles(): string {
    if (this.options.preserveLayout) {
      return `
@media (max-width: 768px) {
  .pdf-content {
    padding: 0;
  }
}
`;
    }
    return `
@media (max-width: 768px) {
  .pdf-content {
    padding: 10px;
  }
  
  .pdf-page {
    transform: scale(0.8);
    transform-origin: top left;
  }
}
`;
  }

  private generatePageStyles(pages: PDFPage[]): string {
    if (!this.options.preserveLayout) {
      return '';
    }

    const styles: string[] = [];

    for (const page of pages) {
      const aspectRatio = page.width / page.height;
      styles.push(`
.pdf-page-${page.pageNumber} {
  width: ${page.width}px;
  height: ${page.height}px;
  aspect-ratio: ${aspectRatio};
  position: relative;
  margin: 0;
  background: white;
  box-shadow: none;
}
`);
    }

    return styles.join('\n');
  }

  private generateDarkModeStyles(): string {
    return `
@media (prefers-color-scheme: dark) {
  body {
    background-color: #1a1a1a;
    color: #e0e0e0;
  }
  
  .pdf-page {
    background-color: #2a2a2a;
    color: #e0e0e0;
  }
}
`;
  }

  private generatePrintStyles(): string {
    return `
@media print {
  body {
    background: white;
    color: black;
  }
  
  .pdf-page {
    page-break-after: always;
    box-shadow: none;
    margin: 0;
  }
  
  @page {
    margin: 0;
  }
}
`;
  }

  private getFontClass(fontName: string): string {
    return `font-${this.toFontClassSuffix(fontName)}`;
  }
}


