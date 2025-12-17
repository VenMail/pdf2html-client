import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { join, extname } from 'path';
import * as fontkit from 'fontkit';
import { getBuiltInFontMetricsDb } from '../src/fonts/font-metrics-db.js';
import { normalizeFontName } from '../src/fonts/font-name-normalizer.js';

type UpdateResult = {
  id: string;
  family: string;
  source: 'google' | 'system' | 'skipped' | 'failed';
  filePath?: string;
  metrics?: {
    ascent: number;
    descent: number;
    capHeight: number;
    xHeight: number;
    averageWidth: number;
    maxWidth: number;
    unitsPerEm: number;
  };
  spaceWidth?: number;
  averageCharWidth?: number;
  charWidthOverrides?: Record<string, number>;
  error?: string;
};

type GlyphBBox = {
  maxY?: number;
};

type GlyphLike = {
  advanceWidth?: number;
  bbox?: GlyphBBox;
};

type FontLike = {
  unitsPerEm?: number;
  ascent?: number;
  descent?: number;
  capHeight?: number;
  xHeight?: number;
  glyphForCodePoint: (cp: number) => GlyphLike;
};

function parseArgs(argv: string[]): {
  writeBase: boolean;
  generate: boolean;
  onlyId?: string;
  onlyFamily?: string;
  regen: boolean;
  cacheDir: string;
  source: 'auto' | 'google' | 'system';
} {
  const out: { writeBase: boolean; generate: boolean; onlyId?: string; onlyFamily?: string; regen: boolean; cacheDir: string; source: 'auto' | 'google' | 'system' } = {
    writeBase: false,
    generate: true,
    regen: false,
    cacheDir: join(process.cwd(), 'test-outputs', 'font-cache'),
    source: 'auto'
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--writeBase') out.writeBase = true;
    else if (a === '--generate') out.generate = true;
    else if (a === '--no-generate') out.generate = false;
    else if (a === '--id') out.onlyId = argv[i + 1];
    else if (a === '--family') out.onlyFamily = argv[i + 1];
    else if (a === '--regen') out.regen = true;
    else if (a === '--cacheDir') out.cacheDir = argv[i + 1] || out.cacheDir;
    else if (a === '--source') {
      const v = argv[i + 1];
      if (v === 'auto' || v === 'google' || v === 'system') out.source = v;
    }
  }

  return out;
}

function isLikelyVirtualAlias(key: string): boolean {
  const k = (key || '').toLowerCase();
  return k === 'system' || k === 'system ui' || k === 'sans serif' || k === 'sans-serif' || k === 'serif' || k === 'monospace';
}

function normalizeFamilyKey(name: string): string {
  const raw = String(name || '');
  const expanded = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-/]+/g, ' ')
    .replace(/(bolditalic|boldoblique|bold|italic|oblique|regular|black|heavy|semibold|demibold|medium|light|thin)/gi, ' $1 ')
    .replace(/(sansserif|sans|serif|monospace|mono|condensed|narrow|expanded)/gi, ' $1 ')
    .replace(/\b(mt|psmt|ps)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const n = normalizeFontName(expanded);
  return (n.family || '').toLowerCase();
}

function idFromFamilyKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function toDisplayFamilyName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  const parts = s
    .replace(/[_\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter((p) => p.length > 0);
  return parts
    .map((p) => {
      if (/^[0-9]+$/.test(p)) return p;
      if (p.length <= 2) return p.toUpperCase();
      return p.slice(0, 1).toUpperCase() + p.slice(1);
    })
    .join(' ');
}

function rankCandidateName(s: string): number {
  const v = String(s || '').trim();
  if (!v) return -Infinity;
  const lower = v.toLowerCase();
  let score = 0;
  if (v.includes(' ')) score += 8;
  if (/[A-Z]/.test(v)) score += 3;
  if (!/[0-9]/.test(v)) score += 1;
  if (lower.includes('regular') || lower.includes('roman')) score += 2;
  if (lower.includes('bold') || lower.includes('italic') || lower.includes('oblique')) score -= 3;
  score += Math.min(6, v.length / 6);
  return score;
}

function uniqueStrings(arr: string[]): string[] {
  const byKey = new Map<string, { value: string; score: number; order: number }>();
  let order = 0;
  for (const a of arr) {
    const v = String(a || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    const score = rankCandidateName(v);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { value: v, score, order: order++ });
      continue;
    }
    if (score > existing.score) {
      byKey.set(k, { value: v, score, order: existing.order });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.order - b.order)
    .map((v) => v.value);
}

function ensureDir(p: string): void {
  if (existsSync(p)) return;
  mkdirSync(p, { recursive: true });
}

function normalizeForFileMatch(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function requestBuffer(
  url: string,
  headers: Record<string, string>,
  redirectsLeft = 5
): Promise<{ status: number; statusText: string; body: Buffer }> {
  return await new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const reqFn = u.protocol === 'http:' ? httpRequest : httpsRequest;

      const req = reqFn(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port ? Number(u.port) : undefined,
          path: `${u.pathname}${u.search}`,
          method: 'GET',
          headers
        },
        (res) => {
          const status = res.statusCode || 0;
          const statusText = res.statusMessage || '';

          const loc = res.headers.location;
          if (status >= 300 && status < 400 && typeof loc === 'string' && redirectsLeft > 0) {
            const next = new URL(loc, url).toString();
            res.resume();
            requestBuffer(next, headers, redirectsLeft - 1).then(resolve).catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            resolve({ status, statusText, body: Buffer.concat(chunks) });
          });
        }
      );
      req.on('error', reject);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchText(url: string): Promise<string> {
  const headers = {
    'user-agent': 'Mozilla/5.0',
    accept: 'text/css,*/*;q=0.1'
  };

  if (typeof fetch === 'function') {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        body = '';
      }
      const snippet = body ? body.slice(0, 200).replace(/\s+/g, ' ').trim() : '';
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${snippet ? ` (${snippet})` : ''}`);
    }
    return await res.text();
  }

  const res = await requestBuffer(url, headers);
  if (res.status < 200 || res.status >= 300) {
    const snippet = res.body.length > 0 ? res.body.toString('utf-8').slice(0, 200).replace(/\s+/g, ' ').trim() : '';
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${snippet ? ` (${snippet})` : ''}`);
  }
  return res.body.toString('utf-8');
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const headers = {
    'user-agent': 'Mozilla/5.0',
    accept: '*/*'
  };

  if (typeof fetch === 'function') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  const res = await requestBuffer(url, headers);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return new Uint8Array(res.body);
}

function extractBestFontUrlFromCss(css: string): { url: string; ext: string } | undefined {
  type Found = { url: string; ext: string; rank: number };
  const found: Found[] = [];

  const re = /url\((['"]?)(https:\/\/[^'")]+)\1\)\s*format\((['"]?)(woff2|woff|truetype|opentype)\3\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const url = m[2];
    const fmt = (m[4] || '').toLowerCase();
    const ext = fmt === 'woff2' ? 'woff2' : fmt === 'woff' ? 'woff' : fmt === 'opentype' ? 'otf' : 'ttf';
    const rank = fmt === 'woff2' ? 4 : fmt === 'woff' ? 3 : fmt === 'opentype' ? 2 : 1;
    found.push({ url, ext, rank });
  }

  if (found.length === 0) return undefined;
  found.sort((a, b) => b.rank - a.rank);
  return { url: found[0].url, ext: found[0].ext };
}

async function downloadGoogleFontBinary(family: string, cacheDir: string): Promise<{ filePath: string; bytes: Uint8Array }> {
  const familyParam = encodeURIComponent(family).replace(/%20/g, '+');
  const cssUrls = [
    `https://fonts.googleapis.com/css2?family=${familyParam}:wght@400&display=swap`,
    `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`
  ];

  let css: string | undefined;
  let lastErr: string | undefined;
  for (const u of cssUrls) {
    try {
      css = await fetchText(u);
      if (css && css.length > 0) break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      css = undefined;
    }
  }

  if (!css) throw new Error(`No CSS for family ${family}${lastErr ? ` (${lastErr})` : ''}`);
  const best = extractBestFontUrlFromCss(css);
  if (!best) throw new Error(`No font URL in CSS for family ${family}`);

  const bytes = await fetchBinary(best.url);
  ensureDir(cacheDir);
  const filePath = join(cacheDir, `${normalizeForFileMatch(family)}.${best.ext}`);
  writeFileSync(filePath, Buffer.from(bytes));
  return { filePath, bytes };
}

function listSystemFontFiles(): string[] {
  const dirs: string[] = [];
  if (process.platform === 'win32') dirs.push('C:\\Windows\\Fonts');
  if (process.platform === 'darwin') dirs.push('/System/Library/Fonts', '/Library/Fonts');
  if (process.platform === 'linux') dirs.push('/usr/share/fonts', '/usr/local/share/fonts');

  const out: string[] = [];
  for (const d of dirs) {
    try {
      if (!existsSync(d)) continue;
      const entries = readdirSync(d);
      for (const e of entries) {
        const p = join(d, e);
        try {
          const st = statSync(p);
          if (!st.isFile()) continue;
          const ext = extname(p).toLowerCase();
          if (ext === '.ttf' || ext === '.otf' || ext === '.ttc' || ext === '.woff' || ext === '.woff2') {
            out.push(p);
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return out;
}

function pickBestSystemFontFile(families: string[], candidates: string[]): string | undefined {
  const needles = uniqueStrings(families).map((f) => normalizeForFileMatch(f)).filter((n) => n.length > 0);
  if (needles.length === 0) return undefined;

  let best: { p: string; score: number } | undefined;
  for (const p of candidates) {
    const base = normalizeForFileMatch(p);
    let score = 0;
    for (const needle of needles) {
      if (base.includes(needle)) score += 10;
      if (base.includes(needle + 'regular')) score += 3;
      if (base.includes(needle + 'roman')) score += 2;
      if (base.includes(needle + 'book')) score += 1;
    }
    if (base.includes('bold') || base.includes('italic') || base.includes('oblique')) score -= 2;
    if (!best || score > best.score) best = { p, score };
  }
  return best && best.score > 0 ? best.p : undefined;
}

function openFontFromBytes(bytes: Uint8Array): FontLike {
  return (fontkit as unknown as { create: (b: Buffer) => unknown }).create(Buffer.from(bytes)) as FontLike;
}

function openFontFromFile(filePath: string): FontLike {
  return (fontkit as unknown as { openSync: (p: string) => unknown }).openSync(filePath) as FontLike;
}

function glyphAdvance(font: FontLike, ch: string): number | undefined {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return undefined;
  try {
    const g = font.glyphForCodePoint(cp);
    const w = g?.advanceWidth;
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) return w;
  } catch {
    return undefined;
  }
  return undefined;
}

function glyphCapHeight(font: FontLike): number | undefined {
  try {
    const g = font.glyphForCodePoint('H'.codePointAt(0)!);
    const b = g?.bbox;
    const y = b?.maxY;
    if (typeof y === 'number' && Number.isFinite(y) && y > 0) return y;
  } catch {
    return undefined;
  }
  return undefined;
}

function glyphXHeight(font: FontLike): number | undefined {
  try {
    const g = font.glyphForCodePoint('x'.codePointAt(0)!);
    const b = g?.bbox;
    const y = b?.maxY;
    if (typeof y === 'number' && Number.isFinite(y) && y > 0) return y;
  } catch {
    return undefined;
  }
  return undefined;
}

function computeMetrics(font: FontLike): {
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  averageWidth: number;
  maxWidth: number;
  unitsPerEm: number;
  spaceWidth: number;
  averageCharWidth: number;
  charWidthOverrides: Record<string, number>;
} {
  const unitsPerEm = Number(font.unitsPerEm || 1000);
  const ascentRaw = Number(font.ascent || 0);
  const descentRaw = Number(font.descent || 0);

  const capFromFont = typeof font.capHeight === 'number' ? font.capHeight : undefined;
  const xFromFont = typeof font.xHeight === 'number' ? font.xHeight : undefined;
  const capRaw = Number.isFinite(capFromFont) && (capFromFont ?? 0) > 0 ? Number(capFromFont) : (glyphCapHeight(font) ?? 0);
  const xRaw = Number.isFinite(xFromFont) && (xFromFont ?? 0) > 0 ? Number(xFromFont) : (glyphXHeight(font) ?? 0);

  const sampleChars = (
    'abcdefghijklmnopqrstuvwxyz' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    '0123456789'
  ).split('');

  const widths: number[] = [];
  for (const ch of sampleChars) {
    const w = glyphAdvance(font, ch);
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) widths.push(w);
  }

  const avg = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : unitsPerEm * 0.5;
  const mx = widths.length > 0 ? Math.max(...widths) : unitsPerEm * 0.8;

  const overridesChars = [' ', ':', '.', ',', '-', '\u2019', "'", '"', '\u201C', '\u201D'];
  const overrides: Record<string, number> = {};
  for (const ch of overridesChars) {
    const w = glyphAdvance(font, ch);
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) overrides[ch] = w;
  }

  const spaceW = overrides[' '] ?? glyphAdvance(font, ' ') ?? avg;

  const scale = 1000 / (unitsPerEm > 0 ? unitsPerEm : 1000);
  const round = (v: number): number => Math.round(v * scale);

  const ascent = round(ascentRaw);
  const descent = round(Math.abs(descentRaw));
  const capHeight = round(capRaw > 0 ? capRaw : ascentRaw * 0.75);
  const xHeight = round(xRaw > 0 ? xRaw : ascentRaw * 0.5);
  const averageWidth = round(avg);
  const maxWidth = round(mx);

  const scaledOverrides: Record<string, number> = {};
  for (const [k, v] of Object.entries(overrides)) {
    const rv = round(v);
    if (Number.isFinite(rv) && rv > 0) scaledOverrides[k] = rv;
  }

  return {
    ascent,
    descent,
    capHeight,
    xHeight,
    averageWidth,
    maxWidth,
    unitsPerEm: 1000,
    spaceWidth: round(spaceW),
    averageCharWidth: averageWidth,
    charWidthOverrides: scaledOverrides
  };
}

function tsSingleQuoteString(s: string): string {
  return `'${String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}'`;
}

function renderCharWidthOverridesTs(overrides: Record<string, number>, indent: string): string {
  const entries = Object.entries(overrides)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '{}';

  const innerIndent = indent + '  ';
  const lines = entries.map(([k, v]) => `${innerIndent}${tsSingleQuoteString(k)}: ${Math.round(v)},`);
  return `\n${indent}{\n${lines.join('\n')}\n${indent}}`;
}

function renderGeneratedDbTs(records: Array<{
  id: string;
  family: string;
  category: string;
  aliases: string[];
  metrics: { ascent: number; descent: number; capHeight: number; xHeight: number; averageWidth: number; maxWidth: number; unitsPerEm: number };
  spaceWidth?: number;
  averageCharWidth?: number;
  charWidthOverrides?: Record<string, number>;
}>): string {
  const lines: string[] = [];
  lines.push("import type { FontMetricsRecord } from './font-metrics-db.js';");
  lines.push('');
  lines.push('const GENERATED: FontMetricsRecord[] = [');

  for (const r of records) {
    lines.push('  {');
    lines.push(`    id: ${tsSingleQuoteString(r.id)},`);
    lines.push(`    family: ${tsSingleQuoteString(r.family)},`);
    lines.push(`    category: ${tsSingleQuoteString(r.category)},`);
    lines.push('    aliases: [');
    for (const a of r.aliases) {
      lines.push(`      ${tsSingleQuoteString(a)},`);
    }
    lines.push('    ],');
    lines.push('    metrics: {');
    lines.push(`      ascent: ${r.metrics.ascent},`);
    lines.push(`      descent: ${r.metrics.descent},`);
    lines.push(`      capHeight: ${r.metrics.capHeight},`);
    lines.push(`      xHeight: ${r.metrics.xHeight},`);
    lines.push(`      averageWidth: ${r.metrics.averageWidth},`);
    lines.push(`      maxWidth: ${r.metrics.maxWidth},`);
    lines.push(`      unitsPerEm: ${r.metrics.unitsPerEm}`);
    lines.push('    },');

    if (typeof r.spaceWidth === 'number') lines.push(`    spaceWidth: ${r.spaceWidth},`);
    if (typeof r.averageCharWidth === 'number') lines.push(`    averageCharWidth: ${r.averageCharWidth},`);
    if (r.charWidthOverrides && Object.keys(r.charWidthOverrides).length > 0) {
      const rendered = renderCharWidthOverridesTs(r.charWidthOverrides, '    ');
      for (const ln of rendered.split('\n')) {
        const t = ln.trim();
        if (t.length === 0) continue;
        if (t === '{') {
          lines.push('    charWidthOverrides: {');
          continue;
        }
        if (t === '}') {
          lines.push('    },');
          continue;
        }
        lines.push(ln);
      }
    }

    lines.push('  },');
  }

  lines.push('];');
  lines.push('');
  lines.push('export function getGeneratedFontMetricsDb(): FontMetricsRecord[] {');
  lines.push('  return GENERATED.map((r) => ({');
  lines.push('    ...r,');
  lines.push('    aliases: [...r.aliases],');
  lines.push('    metrics: { ...r.metrics },');
  lines.push('    charWidthOverrides: r.charWidthOverrides ? { ...r.charWidthOverrides } : undefined');
  lines.push('  }));');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function findObjectStartForId(source: string, id: string): number {
  const needle = `id: '${id}'`;
  return source.indexOf(needle);
}

function findBraceRange(source: string, startIndex: number): { start: number; end: number } | null {
  const open = source.indexOf('{', startIndex);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { start: open, end: i };
    }
  }
  return null;
}

function replaceNumberProp(block: string, prop: string, value: number): string {
  const re = new RegExp(`(${prop}:\\s*)([-]?[0-9]+(?:\\.[0-9]+)?)`, 'm');
  if (!re.test(block)) return block;
  return block.replace(re, `$1${value}`);
}

function replaceOrInsertNumberProp(objText: string, prop: string, value: number): string {
  const re = new RegExp(`(^\\s+${prop}:\\s*)([-]?[0-9]+(?:\\.[0-9]+)?)(\\s*,?)\\s*$`, 'm');
  if (re.test(objText)) {
    return objText.replace(re, `$1${value}$3`);
  }

  const endBrace = objText.lastIndexOf('}');
  if (endBrace < 0) return objText;

  const before = objText.slice(0, endBrace);
  const after = objText.slice(endBrace);
  const needsComma = /,\s*$/.test(before.trimEnd());
  const insert = `${needsComma ? '' : ','}\n    ${prop}: ${value}`;
  return before + insert + after;
}

function replaceOrInsertCharWidthOverrides(objText: string, overrides: Record<string, number>): string {
  const prop = 'charWidthOverrides';
  const propPos = objText.indexOf(`${prop}:`);
  if (propPos >= 0) {
    const brace = findBraceRange(objText, propPos);
    if (!brace) return objText;
    const rendered = renderCharWidthOverridesTs(overrides, '    ');
    const newBlock = `{${rendered.startsWith('\n') ? rendered : rendered}`;
    return objText.slice(0, brace.start) + newBlock + objText.slice(brace.end + 1);
  }

  const endBrace = objText.lastIndexOf('}');
  if (endBrace < 0) return objText;
  const before = objText.slice(0, endBrace);
  const after = objText.slice(endBrace);
  const needsComma = /,\s*$/.test(before.trimEnd());
  const rendered = renderCharWidthOverridesTs(overrides, '    ');
  const insert = `${needsComma ? '' : ','}\n    ${prop}: {${rendered.startsWith('\n') ? rendered : rendered}}`;
  return before + insert + after;
}

function replaceMetricsForId(source: string, id: string, update: UpdateResult): string {
  const idPos = findObjectStartForId(source, id);
  if (idPos < 0) return source;

  const objRange = findBraceRange(source, idPos);
  if (!objRange) return source;
  const objText = source.slice(objRange.start, objRange.end + 1);

  const metricsPos = objText.indexOf('metrics:');
  if (metricsPos < 0) return source;

  const metricsRange = findBraceRange(objText, metricsPos);
  if (!metricsRange) return source;

  let metricsBlock = objText.slice(metricsRange.start, metricsRange.end + 1);

  const m = update.metrics;
  if (!m) return source;

  metricsBlock = replaceNumberProp(metricsBlock, 'ascent', m.ascent);
  metricsBlock = replaceNumberProp(metricsBlock, 'descent', m.descent);
  metricsBlock = replaceNumberProp(metricsBlock, 'capHeight', m.capHeight);
  metricsBlock = replaceNumberProp(metricsBlock, 'xHeight', m.xHeight);
  metricsBlock = replaceNumberProp(metricsBlock, 'averageWidth', m.averageWidth);
  metricsBlock = replaceNumberProp(metricsBlock, 'maxWidth', m.maxWidth);

  const newObjText = objText.slice(0, metricsRange.start) + metricsBlock + objText.slice(metricsRange.end + 1);

  let finalObjText = newObjText;
  if (typeof update.spaceWidth === 'number') {
    finalObjText = replaceOrInsertNumberProp(finalObjText, 'spaceWidth', update.spaceWidth);
  }
  if (typeof update.averageCharWidth === 'number') {
    finalObjText = replaceOrInsertNumberProp(finalObjText, 'averageCharWidth', update.averageCharWidth);
  }
  if (update.charWidthOverrides && Object.keys(update.charWidthOverrides).length > 0) {
    finalObjText = replaceOrInsertCharWidthOverrides(finalObjText, update.charWidthOverrides);
  }

  const out = source.slice(0, objRange.start) + finalObjText + source.slice(objRange.end + 1);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const db = getBuiltInFontMetricsDb();
  const records = args.onlyId ? db.filter((r) => r.id === args.onlyId) : db;

  const systemFiles = listSystemFontFiles();

  const results: UpdateResult[] = [];

  const existingFamilyKeys = new Set<string>();
  for (const r of records) {
    if (r.id.startsWith('default_')) continue;
    existingFamilyKeys.add(normalizeFamilyKey(r.family));
  }

  const targets: Array<{ key: string; names: string[]; category: string }> = [];
  if (args.generate) {
    const byKey = new Map<string, { names: Set<string>; categories: Map<string, number> }>();
    for (const r of records) {
      if (r.id.startsWith('default_')) continue;
      const cat = r.category;
      const all = [r.family, ...(r.aliases || [])];
      for (const raw of all) {
        const key = normalizeFamilyKey(raw);
        if (!key) continue;
        if (isLikelyVirtualAlias(key)) continue;
        if (!args.regen && existingFamilyKeys.has(key)) continue;
        if (args.onlyFamily) {
          const wanted = normalizeFamilyKey(args.onlyFamily);
          if (wanted && key !== wanted) continue;
        }
        const entry = byKey.get(key) || { names: new Set<string>(), categories: new Map<string, number>() };
        entry.names.add(String(raw));
        entry.names.add(toDisplayFamilyName(String(raw)));
        entry.categories.set(cat, (entry.categories.get(cat) || 0) + 1);
        byKey.set(key, entry);
      }
    }

    if (args.onlyFamily) {
      const wanted = normalizeFamilyKey(args.onlyFamily);
      if (wanted && !byKey.has(wanted)) {
        const entry = { names: new Set<string>(), categories: new Map<string, number>() };
        entry.names.add(String(args.onlyFamily));
        entry.names.add(toDisplayFamilyName(String(args.onlyFamily)));
        entry.categories.set('sans-serif', 1);
        byKey.set(wanted, entry);
      }
    }

    for (const [key, v] of byKey) {
      const names = uniqueStrings(Array.from(v.names)).sort((a, b) => rankCandidateName(b) - rankCandidateName(a));
      const sortedCats = Array.from(v.categories.entries()).sort((a, b) => (b[1] || 0) - (a[1] || 0));
      const category = (sortedCats[0]?.[0] || 'sans-serif') as string;
      targets.push({ key, names, category });
    }
  }

  for (const r of records) {
    if (r.id.startsWith('default_')) {
      results.push({ id: r.id, family: r.family, source: 'skipped' });
      continue;
    }

    let font: FontLike | undefined;
    let filePath: string | undefined;
    let source: 'google' | 'system' | 'failed' = 'failed';

    const tryGoogle = async (names: string[]): Promise<boolean> => {
      try {
        for (const nm of names) {
          try {
            const dl = await downloadGoogleFontBinary(nm, args.cacheDir);
            filePath = dl.filePath;
            font = openFontFromBytes(dl.bytes);
            source = 'google';
            return true;
          } catch {
            continue;
          }
        }
        return false;
      } catch {
        return false;
      }
    };

    const trySystem = (names: string[]): boolean => {
      try {
        const picked = pickBestSystemFontFile(names, systemFiles);
        if (!picked) return false;
        filePath = picked;
        font = openFontFromFile(picked);
        source = 'system';
        return true;
      } catch {
        return false;
      }
    };

    try {
      if (!args.writeBase) {
        results.push({ id: r.id, family: r.family, source: 'skipped' });
        continue;
      }

      let ok = false;
      const nameCandidates = uniqueStrings([r.family]).sort((a, b) => rankCandidateName(b) - rankCandidateName(a));
      if (args.source === 'google') ok = await tryGoogle(nameCandidates);
      else if (args.source === 'system') ok = trySystem(nameCandidates);
      else {
        ok = (await tryGoogle(nameCandidates)) || trySystem(nameCandidates);
      }

      if (!ok || !font) {
        results.push({ id: r.id, family: r.family, source: 'failed', error: 'No font source found' });
        continue;
      }

      const computed = computeMetrics(font);
      const update: UpdateResult = {
        id: r.id,
        family: r.family,
        source,
        filePath,
        metrics: {
          ascent: computed.ascent,
          descent: computed.descent,
          capHeight: computed.capHeight,
          xHeight: computed.xHeight,
          averageWidth: computed.averageWidth,
          maxWidth: computed.maxWidth,
          unitsPerEm: computed.unitsPerEm
        },
        spaceWidth: computed.spaceWidth,
        averageCharWidth: computed.averageCharWidth,
        charWidthOverrides: computed.charWidthOverrides
      };
      results.push(update);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: r.id, family: r.family, source: 'failed', error: msg });
    }
  }

  let outPath = '';
  if (args.writeBase) {
    const targetPath = join(process.cwd(), 'src', 'fonts', 'font-metrics-db.ts');
    const original = readFileSync(targetPath, 'utf-8');

    let updated = original;
    for (const r of results) {
      if (r.source === 'google' || r.source === 'system') {
        updated = replaceMetricsForId(updated, r.id, r);
      }
    }
    outPath = targetPath;
    writeFileSync(outPath, updated, 'utf-8');
  } else {
    outPath = join(process.cwd(), 'src', 'fonts', 'font-metrics-db.ts.updated');
    const targetPath = join(process.cwd(), 'src', 'fonts', 'font-metrics-db.ts');
    writeFileSync(outPath, readFileSync(targetPath, 'utf-8'), 'utf-8');
  }

  if (args.generate) {
    const generatedRecords: Array<{
      id: string;
      family: string;
      category: string;
      aliases: string[];
      metrics: { ascent: number; descent: number; capHeight: number; xHeight: number; averageWidth: number; maxWidth: number; unitsPerEm: number };
      spaceWidth?: number;
      averageCharWidth?: number;
      charWidthOverrides?: Record<string, number>;
    }> = [];

    for (const t of targets) {
      let font: FontLike | undefined;
      let filePath: string | undefined;
      let source: 'google' | 'system' | 'failed' = 'failed';

      let googleError: string | undefined;
      let systemError: string | undefined;

      const names = t.names;
      const ok = (args.source === 'system')
        ? ((): boolean => {
            try {
              const picked = pickBestSystemFontFile(names, systemFiles);
              if (!picked) return false;
              filePath = picked;
              font = openFontFromFile(picked);
              source = 'system';
              return true;
            } catch (e) {
              systemError = e instanceof Error ? e.message : String(e);
              return false;
            }
          })()
        : await (async (): Promise<boolean> => {
            const gOk = (args.source === 'google' || args.source === 'auto') ? await (async (): Promise<boolean> => {
              for (const nm of names) {
                try {
                  const dl = await downloadGoogleFontBinary(nm, args.cacheDir);
                  filePath = dl.filePath;
                  font = openFontFromBytes(dl.bytes);
                  source = 'google';
                  return true;
                } catch (e) {
                  googleError = e instanceof Error ? e.message : String(e);
                  continue;
                }
              }
              return false;
            })() : false;
            if (gOk) return true;
            try {
              const picked = pickBestSystemFontFile(names, systemFiles);
              if (!picked) return false;
              filePath = picked;
              font = openFontFromFile(picked);
              source = 'system';
              return true;
            } catch (e) {
              systemError = e instanceof Error ? e.message : String(e);
              return false;
            }
          })();

      if (!ok || !font) {
        const errParts = [
          googleError ? `google: ${googleError}` : undefined,
          systemError ? `system: ${systemError}` : undefined
        ].filter((x): x is string => !!x);
        const err = errParts.length > 0 ? errParts.join(' | ') : 'No font source found';
        results.push({ id: idFromFamilyKey(t.key), family: t.key, source: 'failed', error: err });
        continue;
      }

      const computed = computeMetrics(font);
      const id = idFromFamilyKey(t.key);
      const displayFamily = toDisplayFamilyName(names[0] || t.key);
      generatedRecords.push({
        id,
        family: displayFamily,
        category: t.category,
        aliases: uniqueStrings([displayFamily, ...names]).slice(0, 60),
        metrics: {
          ascent: computed.ascent,
          descent: computed.descent,
          capHeight: computed.capHeight,
          xHeight: computed.xHeight,
          averageWidth: computed.averageWidth,
          maxWidth: computed.maxWidth,
          unitsPerEm: 1000
        },
        spaceWidth: computed.spaceWidth,
        averageCharWidth: computed.averageCharWidth,
        charWidthOverrides: computed.charWidthOverrides
      });

      results.push({
        id,
        family: displayFamily,
        source,
        filePath,
        metrics: {
          ascent: computed.ascent,
          descent: computed.descent,
          capHeight: computed.capHeight,
          xHeight: computed.xHeight,
          averageWidth: computed.averageWidth,
          maxWidth: computed.maxWidth,
          unitsPerEm: 1000
        },
        spaceWidth: computed.spaceWidth,
        averageCharWidth: computed.averageCharWidth,
        charWidthOverrides: computed.charWidthOverrides
      });
    }

    generatedRecords.sort((a, b) => a.family.localeCompare(b.family));
    if (generatedRecords.length > 0 || !args.onlyFamily) {
      const generatedPath = join(process.cwd(), 'src', 'fonts', 'font-metrics-db.generated.ts');
      writeFileSync(generatedPath, renderGeneratedDbTs(generatedRecords), 'utf-8');
    }
  }

  ensureDir(join(process.cwd(), 'test-outputs'));
  writeFileSync(join(process.cwd(), 'test-outputs', 'font-metrics-report.json'), JSON.stringify(results, null, 2), 'utf-8');

  const summary = {
    updated: results.filter((r) => r.source === 'google' || r.source === 'system').length,
    failed: results.filter((r) => r.source === 'failed').length,
    skipped: results.filter((r) => r.source === 'skipped').length,
    output: outPath
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
