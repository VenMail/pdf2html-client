import type { ClassifierProfile, NormalizedGlyphItem, TextScript } from './types.js';

const PROFILES: Record<string, ClassifierProfile> = {
  'latin-default': {
    name: 'latin-default',
    script: 'latin',
    wordBreakThresholdScale: 1.0,
    digitWordBreakThresholdMin: 1.35
  },
  'latin-words': {
    name: 'latin-words',
    script: 'latin',
    wordBreakThresholdScale: 1.0,
    digitWordBreakThresholdMin: 1.35,
    splitLowerUpper: true,
    splitAllCaps: true,
    splitDigitAlpha: true
  },
  'latin-tight': {
    name: 'latin-tight',
    script: 'latin',
    wordBreakThresholdScale: 1.1,
    digitWordBreakThresholdMin: 1.45
  },
  'latin-loose': {
    name: 'latin-loose',
    script: 'latin',
    wordBreakThresholdScale: 0.9,
    digitWordBreakThresholdMin: 1.15
  },
  'auto-default': {
    name: 'auto-default',
    script: 'auto',
    wordBreakThresholdScale: 1.0,
    digitWordBreakThresholdMin: 1.35
  },
  'cyrillic-default': {
    name: 'cyrillic-default',
    script: 'cyrillic',
    wordBreakThresholdScale: 1.05,
    digitWordBreakThresholdMin: 1.35
  },
  'greek-default': {
    name: 'greek-default',
    script: 'greek',
    wordBreakThresholdScale: 1.05,
    digitWordBreakThresholdMin: 1.35
  },
  'arabic-default': {
    name: 'arabic-default',
    script: 'arabic',
    wordBreakThresholdScale: 1.15,
    digitWordBreakThresholdMin: 1.35
  },
  'hebrew-default': {
    name: 'hebrew-default',
    script: 'hebrew',
    wordBreakThresholdScale: 1.1,
    digitWordBreakThresholdMin: 1.35
  },
  'devanagari-default': {
    name: 'devanagari-default',
    script: 'devanagari',
    wordBreakThresholdScale: 1.1,
    digitWordBreakThresholdMin: 1.35
  },
  'cjk-default': {
    name: 'cjk-default',
    script: 'cjk',
    joinCjk: true,
    wordBreakThresholdScale: 2.0
  }
};

export function listClassifierProfiles(): ClassifierProfile[] {
  return Object.values(PROFILES).map((p) => ({ ...p }));
}

export function getClassifierProfile(name?: string): ClassifierProfile {
  const key = typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'auto-default';
  const found = PROFILES[key] ?? PROFILES['auto-default'];
  return { ...found };
}

export function resolveScriptForGlyphs(items: NormalizedGlyphItem[], fallback: TextScript = 'latin'): TextScript {
  if (!items || items.length === 0) return fallback;

  const counts: Record<TextScript, number> = {
    latin: 0,
    cyrillic: 0,
    greek: 0,
    cjk: 0,
    arabic: 0,
    hebrew: 0,
    devanagari: 0,
    other: 0
  };

  for (const it of items) {
    const t = it.text || '';
    for (let i = 0; i < t.length; i++) {
      const cp = t.codePointAt(i);
      if (cp === undefined) continue;
      const script = classifyCodePoint(cp);
      counts[script]++;
      if (cp > 0xffff) i++;
    }
  }

  let best: TextScript = fallback;
  let bestCount = 0;
  for (const k of Object.keys(counts) as TextScript[]) {
    const v = counts[k];
    if (v > bestCount) {
      bestCount = v;
      best = k;
    }
  }

  return bestCount > 0 ? best : fallback;
}

function classifyCodePoint(cp: number): TextScript {
  if ((cp >= 0x0041 && cp <= 0x007a) || (cp >= 0x00c0 && cp <= 0x024f)) return 'latin';
  if (cp >= 0x0370 && cp <= 0x03ff) return 'greek';
  if (cp >= 0x0400 && cp <= 0x052f) return 'cyrillic';
  if (
    (cp >= 0x0590 && cp <= 0x05ff) ||
    (cp >= 0xfb1d && cp <= 0xfb4f)
  ) return 'hebrew';
  if (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  ) return 'arabic';
  if (cp >= 0x0900 && cp <= 0x097f) return 'devanagari';
  if (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0xac00 && cp <= 0xd7af)
  ) return 'cjk';
  return 'other';
}
