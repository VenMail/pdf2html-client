import type { GoogleFont } from '../types/fonts.js';

export class GoogleFontsAPI {
  private cache: Map<string, GoogleFont[]> = new Map();
  private allFonts: GoogleFont[] | null = null;
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || null;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.clearCache(); // Clear cache when API key changes
  }

  async getAllFonts(): Promise<GoogleFont[]> {
    if (this.allFonts) {
      return this.allFonts;
    }

    // If no API key, use fallback fonts
    if (!this.apiKey) {
      console.warn('Google Fonts API key not provided, using fallback fonts');
      return this.getFallbackFonts();
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/webfonts/v1/webfonts?key=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch Google Fonts');
      }

      const data = await response.json();
      this.allFonts = data.items || [];
      return this.allFonts as GoogleFont[];
    } catch (error) {
      console.warn('Failed to fetch Google Fonts, using fallback list:', error);
      return this.getFallbackFonts();
    }
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

