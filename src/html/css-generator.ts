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

    if (this.cssOptions.includeFonts) {
      const imports = this.generateGoogleFontsImport(fontMappings);
      if (imports) {
        styles.push(imports);
      }
    }

    if (this.cssOptions.includeReset) {
      styles.push(this.generateReset());
    }

    if (this.cssOptions.includeFonts) {
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

  private generateFontRules(fontMappings: FontMapping[]): string {
    const rules: string[] = [];

    const seen = new Set<string>();

    for (const mapping of fontMappings) {
      const fallback = mapping.fallbackChain.map((f) => this.quoteFontFamily(f)).join(', ');
      const fontClass = this.getFontClass(mapping.googleFont.family);

      if (seen.has(fontClass)) continue;
      seen.add(fontClass);

      rules.push(`
.${fontClass} {
  font-family: ${this.quoteFontFamily(mapping.googleFont.family)}, ${fallback};
}
`);
    }

    return rules.join('\n');
  }

  private generateGoogleFontsImport(fontMappings: FontMapping[]): string {
    if (!fontMappings || fontMappings.length === 0) return '';

    const weightsByFamily = new Map<string, Set<number>>();
    for (const m of fontMappings) {
      const family = String(m.googleFont?.family || '').trim();
      if (!family) continue;

      const wSet = weightsByFamily.get(family) ?? new Set<number>();

      const variant = String(m.variant || '').trim();
      const vNum = variant.match(/\d{3}/)?.[0];
      const weight = vNum ? Number(vNum) : (typeof m.detectedFont?.weight === 'number' ? m.detectedFont.weight : 400);
      if (Number.isFinite(weight) && weight > 0) {
        wSet.add(Math.max(100, Math.min(900, Math.round(weight / 100) * 100)));
      }

      weightsByFamily.set(family, wSet);
    }

    const families = Array.from(weightsByFamily.entries());
    if (families.length === 0) return '';

    const params = families
      .map(([family, weights]) => {
        const w = Array.from(weights).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
        const weightsPart = w.length > 0 ? `:wght@${w.join(';')}` : '';
        const encodedFamily = encodeURIComponent(family).replace(/%20/g, '+');
        return `family=${encodedFamily}${weightsPart}`;
      })
      .join('&');

    return `@import url('https://fonts.googleapis.com/css2?${params}&display=swap');`;
  }

  private quoteFontFamily(family: string): string {
    const raw = String(family || '').trim();
    if (!raw) return raw;
    const lower = raw.toLowerCase();
    const isGeneric =
      lower === 'serif' ||
      lower === 'sans-serif' ||
      lower === 'monospace' ||
      lower === 'cursive' ||
      lower === 'fantasy' ||
      lower === 'system-ui';
    if (isGeneric) return lower;
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw;
    if (raw.includes(' ')) return `'${raw}'`;
    return raw;
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


