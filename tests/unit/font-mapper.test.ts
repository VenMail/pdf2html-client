import { describe, it, expect, beforeEach } from 'vitest';
import { FontMapper } from '../../src/fonts/font-mapper.js';
import { FontDetector } from '../../src/fonts/font-detector.js';
import type { DetectedFont } from '../../src/types/fonts.js';

describe('FontMapper', () => {
  let mapper: FontMapper;
  let detector: FontDetector;

  beforeEach(() => {
    mapper = new FontMapper({
      strategy: 'similar',
      similarityThreshold: 0.7,
      cacheEnabled: true
    });
    detector = new FontDetector();
  });

  it('should map font to Google Fonts', async () => {
    const detectedFont: DetectedFont = {
      name: 'Arial',
      family: 'Arial',
      weight: 400,
      style: 'normal',
      embedded: false,
      metrics: {
        ascent: 905,
        descent: -212,
        capHeight: 716,
        xHeight: 519,
        averageWidth: 500,
        maxWidth: 1000,
        unitsPerEm: 1000
      }
    };

    const mapping = await mapper.mapFont(detectedFont);
    expect(mapping).toBeDefined();
    expect(mapping.googleFont).toBeDefined();
    expect(mapping.fallbackChain.length).toBeGreaterThan(0);
  });

  it('should cache font mappings', async () => {
    const detectedFont: DetectedFont = {
      name: 'Times New Roman',
      family: 'Times New Roman',
      weight: 400,
      style: 'normal',
      embedded: false,
      metrics: {
        ascent: 891,
        descent: -216,
        capHeight: 662,
        xHeight: 447,
        averageWidth: 500,
        maxWidth: 1000,
        unitsPerEm: 1000
      }
    };

    const mapping1 = await mapper.mapFont(detectedFont);
    const mapping2 = await mapper.mapFont(detectedFont);

    expect(mapping1.googleFont.family).toBe(mapping2.googleFont.family);
  });
});


