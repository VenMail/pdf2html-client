import type { GoogleFont } from '../types/fonts.js';

export class GoogleFontsAPI {
  private cache: Map<string, GoogleFont[]> = new Map();
  private allFonts: GoogleFont[] | null = null;

  constructor() {}

  async getAllFonts(): Promise<GoogleFont[]> {
    if (this.allFonts) {
      return this.allFonts;
    }

    this.allFonts = this.getFallbackFonts();
    return this.allFonts;
  }

  async searchFonts(query: string): Promise<GoogleFont[]> {
    const cacheKey = `search:${query}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const allFonts = await this.getAllFonts();
    const results = allFonts.filter(
      (font) =>
        font.family.toLowerCase().includes(query.toLowerCase()) ||
        font.category.toLowerCase().includes(query.toLowerCase())
    );

    this.cache.set(cacheKey, results);
    return results;
  }

  getFontByFamily(family: string): GoogleFont | null {
    if (!this.allFonts) {
      return null;
    }

    return (
      this.allFonts.find(
        (font) => font.family.toLowerCase() === family.toLowerCase()
      ) || null
    );
  }

  private getFallbackFonts(): GoogleFont[] {
    // Fallback list of common Google Fonts
    return [
      {
        family: 'Roboto',
        variants: ['100', '300', '400', '500', '700', '900'],
        subsets: ['latin'],
        category: 'sans-serif',
        version: 'v30',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Open Sans',
        variants: ['300', '400', '600', '700', '800'],
        subsets: ['latin'],
        category: 'sans-serif',
        version: 'v34',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Lato',
        variants: ['100', '300', '400', '700', '900'],
        subsets: ['latin'],
        category: 'sans-serif',
        version: 'v23',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Montserrat',
        variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
        subsets: ['latin'],
        category: 'sans-serif',
        version: 'v25',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Source Sans Pro',
        variants: ['200', '300', '400', '600', '700', '900'],
        subsets: ['latin'],
        category: 'sans-serif',
        version: 'v21',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Merriweather',
        variants: ['300', '400', '700', '900'],
        subsets: ['latin'],
        category: 'serif',
        version: 'v30',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Lora',
        variants: ['400', '500', '600', '700'],
        subsets: ['latin'],
        category: 'serif',
        version: 'v26',
        lastModified: '2023-01-01',
        files: {}
      },
      {
        family: 'Roboto Mono',
        variants: ['100', '200', '300', '400', '500', '600', '700'],
        subsets: ['latin'],
        category: 'monospace',
        version: 'v22',
        lastModified: '2023-01-01',
        files: {}
      }
    ];
  }

  clearCache(): void {
    this.cache.clear();
    this.allFonts = null;
  }
}

