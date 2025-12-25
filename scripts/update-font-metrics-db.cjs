const { writeFileSync, readFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const fontkit = require('fontkit');
const { getBuiltInFontMetricsDb } = require('../src/fonts/font-metrics-db.js');
const { normalizeFontName } = require('../src/fonts/font-name-normalizer.js');

function parseArgs(argv) {
  const out = {
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
    else if (a === '--regen') out.regen = true;
    else if (a === '--cacheDir') out.cacheDir = argv[i + 1] || out.cacheDir;
    else if (a === '--source') {
      const v = argv[i + 1];
      if (v === 'auto' || v === 'google' || v === 'system') out.source = v;
    }
  }

  return out;
}

function isLikelyVirtualAlias(key) {
  const k = (key || '').toLowerCase();
  return k === 'system' || k === 'system ui' || k === 'sans serif' || k === 'sans-serif' || k === 'serif' || k === 'monospace';
}

function normalizeFamilyKey(name) {
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

function idFromFamilyKey(key) {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function toDisplayFamilyName(raw) {
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

function rankCandidateName(s) {
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

function uniqueStrings(arr) {
  const byKey = new Map();
  let order = 0;
  for (const a of arr) {
    const v = String(a || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    const score = rankCandidateName(v);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { value: v, score, order: order++ });
    } else if (score > existing.score) {
      byKey.set(k, { value: v, score, order: existing.order });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((v) => v.value);
}

function ensureDir(dirPath) {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

function renderGeneratedDbTs(records) {
  const imports = `import type { FontMetrics } from './font-metrics-db.js';\n\n`;
  const exports = `export const generatedFontMetricsDb: FontMetrics[] = ${JSON.stringify(records, null, 2)};\n`;
  return imports + exports;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  ensureDir(args.cacheDir);

  const baseDb = getBuiltInFontMetricsDb();
  const results = [];
  const generatedRecords = [];

  console.log('Font metrics database update script');
  console.log('====================================');
  console.log(`Cache dir: ${args.cacheDir}`);
  console.log(`Source: ${args.source}`);
  console.log(`Generate: ${args.generate}`);
  console.log(`Write base: ${args.writeBase}`);
  console.log('');

  // For now, just generate a basic report
  console.log('Note: Full font metrics update requires additional dependencies and Google Fonts API access.');
  console.log('This is a simplified version for compatibility.');

  const summary = {
    updated: 0,
    failed: 0,
    skipped: results.length,
    output: join(process.cwd(), 'test-outputs', 'font-metrics-report.json')
  };

  ensureDir(join(process.cwd(), 'test-outputs'));
  writeFileSync(summary.output, JSON.stringify(results, null, 2), 'utf-8');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
