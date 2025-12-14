export type NormalizedFontName = {
  raw: string;
  cleaned: string;
  family: string;
  isSubset: boolean;
  subsetPrefix?: string;
  weightHint?: number;
  styleHint?: 'normal' | 'italic' | 'oblique';
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripSubsetPrefix(raw: string): { value: string; isSubset: boolean; subsetPrefix?: string } {
  const m = raw.match(/^([A-Z]{6}\+)(.*)$/);
  if (!m) return { value: raw, isSubset: false };
  return { value: m[2] ?? raw, isSubset: true, subsetPrefix: m[1] };
}

function detectStyleHint(s: string): 'normal' | 'italic' | 'oblique' {
  const lower = s.toLowerCase();
  if (/(italic|it)\b/.test(lower)) return 'italic';
  if (/oblique\b/.test(lower)) return 'oblique';
  return 'normal';
}

function detectWeightHint(s: string): number | undefined {
  const lower = s.toLowerCase();
  if (/\bthin\b|\b100\b/.test(lower)) return 100;
  if (/\bextralight\b|\bultralight\b|\b200\b/.test(lower)) return 200;
  if (/\blight\b|\b300\b/.test(lower)) return 300;
  if (/\bregular\b|\bnormal\b|\b400\b/.test(lower)) return 400;
  if (/\bmedium\b|\b500\b/.test(lower)) return 500;
  if (/\bsemibold\b|\bdemibold\b|\b600\b/.test(lower)) return 600;
  if (/\bbold\b|\b700\b/.test(lower)) return 700;
  if (/\bextrabold\b|\bultrabold\b|\b800\b/.test(lower)) return 800;
  if (/\bblack\b|\bheavy\b|\b900\b/.test(lower)) return 900;
  const numeric = lower.match(/\b([1-9]00)\b/);
  if (numeric) return clamp(Number(numeric[1]), 100, 900);
  return undefined;
}

function stripCommonTokens(s: string): string {
  const lower = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])(PSMT|MT|PS)\b/gi, '$1 $2')
    .replace(/[_/]/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/\s*,\s*/g, ' ');

  const withoutPs = lower
    .replace(/\bpsmt\b/g, '')
    .replace(/\bps\b/g, '')
    .replace(/\bmt\b/g, '')
    .replace(/\bstd\b/g, '')
    .replace(/\botf\b/g, '')
    .replace(/\bttf\b/g, '');

  return normalizeSpaces(withoutPs);
}

function stripStyleWeightSuffixes(s: string): string {
  const out = s
    .replace(/\b(bold|black|heavy|semibold|demibold|medium|light|thin|italic|oblique|regular|reg|regu|bd|it|bi)\b/g, '')
    .replace(/\b(condensed|narrow|expanded)\b/g, '');
  return normalizeSpaces(out);
}

export function normalizeFontName(rawName: string): NormalizedFontName {
  const raw = String(rawName ?? '');
  const subset = stripSubsetPrefix(raw);
  const cleaned0 = normalizeSpaces(subset.value);

  const weightHint = detectWeightHint(cleaned0);
  const styleHint = detectStyleHint(cleaned0);

  const lowered = stripCommonTokens(cleaned0).toLowerCase();
  const family = stripStyleWeightSuffixes(lowered);

  return {
    raw,
    cleaned: cleaned0,
    family,
    isSubset: subset.isSubset,
    subsetPrefix: subset.subsetPrefix,
    weightHint,
    styleHint
  };
}
