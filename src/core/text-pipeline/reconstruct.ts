import type { PDFTextContent } from '../../types/pdf.js';
import type { ReconstructedLine } from './types.js';
import type { BoundaryClassifier, ClassifierProfile } from './types.js';
import { normalizeGlyphItems } from './normalizer.js';
import { buildLineGeometryModel } from './line-model.js';
import { getClassifierProfile, resolveScriptForGlyphs } from './classifier-db.js';
import { RuleBoundaryClassifier } from './rule-classifier.js';

export function reconstructLine(
  items: PDFTextContent[],
  options?: {
    classifier?: BoundaryClassifier;
    profile?: ClassifierProfile;
    profileName?: string;
  }
): ReconstructedLine {
  const glyphs = normalizeGlyphItems(items);
  const model = buildLineGeometryModel(glyphs);

  const profile = options?.profile ?? getClassifierProfile(options?.profileName);
  const resolvedScript = profile.script === 'auto' ? resolveScriptForGlyphs(glyphs) : profile.script;
  const classifier = options?.classifier ?? new RuleBoundaryClassifier();
  const ctx = { profile, resolvedScript };

  const parts: string[] = [];
  const decisions: ReconstructedLine['decisions'] = [];

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    if (i === 0) {
      parts.push(g.text);
      continue;
    }

    const prev = glyphs[i - 1];
    const d = classifier.classify(prev, g, model, ctx);
    decisions.push(d);
    if (d.type === 'space') parts.push(' ');
    parts.push(g.text);
  }

  return {
    text: parts.join(''),
    decisions
  };
}
