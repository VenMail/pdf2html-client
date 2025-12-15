export type FontStyle = 'normal' | 'italic' | 'oblique';

function hasToken(s: string, token: string): boolean {
  if (!s) return false;
  return s.includes(token);
}

function hasWord(s: string, word: string): boolean {
  if (!s) return false;
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(s);
}

export function deriveFontWeightFromName(name: string): number {
  const s = (name || '').toLowerCase();

  const num = s.match(/(^|[^0-9])(100|200|300|400|500|600|700|800|900)([^0-9]|$)/);
  if (num) {
    const v = Number(num[2]);
    if (v === 100 || v === 200 || v === 300 || v === 400 || v === 500 || v === 600 || v === 700 || v === 800 || v === 900) {
      return v;
    }
  }

  if (hasToken(s, 'thin')) return 100;
  if (hasToken(s, 'extralight') || hasToken(s, 'ultralight') || hasToken(s, 'extra light') || hasToken(s, 'ultra light')) return 200;
  if (hasToken(s, 'light')) return 300;
  if (hasToken(s, 'medium') || hasWord(s, 'md')) return 500;
  if (hasToken(s, 'semibold') || hasToken(s, 'demibold') || hasToken(s, 'demi bold') || hasWord(s, 'demi')) return 600;
  if (hasToken(s, 'extrabold') || hasToken(s, 'ultrabold') || hasToken(s, 'extra bold') || hasToken(s, 'ultra bold')) return 800;
  if (hasToken(s, 'black') || hasToken(s, 'heavy')) return 900;
  if (hasToken(s, 'bold') || hasWord(s, 'bd')) return 700;

  return 400;
}

export function deriveFontStyleFromName(name: string): FontStyle {
  const s = (name || '').toLowerCase();

  if (hasToken(s, 'italic') || hasToken(s, 'bolditalic') || hasWord(s, 'it') || hasWord(s, 'ital')) return 'italic';
  if (hasToken(s, 'oblique') || hasToken(s, 'boldoblique') || hasWord(s, 'obl')) return 'oblique';
  return 'normal';
}

export function deriveFontWeightAndStyle(args: {
  fontName?: string;
  fontFamily?: string;
  fontFlags?: number;
}): { fontWeight: number; fontStyle: FontStyle; derivedWeight: number; derivedStyle: FontStyle } {
  const fontName = args.fontName || '';
  const fontFamily = args.fontFamily || '';
  const fontFlags = args.fontFlags || 0;

  const derivedWeight = Math.max(deriveFontWeightFromName(fontName), deriveFontWeightFromName(fontFamily));
  const nameStyle = deriveFontStyleFromName(fontName);
  const familyStyle = deriveFontStyleFromName(fontFamily);
  const derivedStyle: FontStyle = nameStyle !== 'normal' ? nameStyle : familyStyle;

  const italicFlag = (fontFlags & 64) === 64;
  const forceBoldFlag = (fontFlags & 262144) === 262144;

  const fontStyle: FontStyle = italicFlag ? 'italic' : derivedStyle;
  const fontWeight = Math.max(derivedWeight, forceBoldFlag ? 700 : 0);

  return { fontWeight, fontStyle, derivedWeight, derivedStyle };
}
