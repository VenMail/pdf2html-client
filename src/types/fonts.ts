export interface DetectedFont {
  name: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic' | 'oblique';
  embedded: boolean;
  metrics: FontMetrics;
  encoding?: string;
}

export interface FontMetrics {
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  averageWidth: number;
  maxWidth: number;
  unitsPerEm: number;
}

export interface GoogleFont {
  family: string;
  variants: string[];
  subsets: string[];
  category: string;
  version: string;
  lastModified: string;
  files: Record<string, string>;
}

export interface FontMapping {
  detectedFont: DetectedFont;
  googleFont: GoogleFont;
  variant: string;
  similarity: number;
  fallbackChain: string[];
}

export interface FontMappingOptions {
  strategy: 'exact' | 'similar' | 'fallback';
  similarityThreshold: number;
  cacheEnabled: boolean;
}


