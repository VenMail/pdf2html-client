import type { PDFTextContent } from '../../types/pdf.js';

export type NormalizedGlyphItem = {
  source: PDFTextContent;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: PDFTextContent['fontStyle'];
  color: string;
  rotation: number;
  baselineY: number;
};

export type LineGeometryModel = {
  estimatedCharWidth: number;
  wordBreakThresholdByChar: number;
};

export type TextScript =
  | 'latin'
  | 'cyrillic'
  | 'greek'
  | 'cjk'
  | 'arabic'
  | 'hebrew'
  | 'devanagari'
  | 'other';

export type ClassifierProfile = {
  name: string;
  script: TextScript | 'auto';
  wordBreakThresholdScale?: number;
  digitWordBreakThresholdMin?: number;
  joinCjk?: boolean;
  splitLowerUpper?: boolean;
  splitAllCaps?: boolean;
  splitDigitAlpha?: boolean;
};

export type BoundaryDecisionType = 'join' | 'space' | 'break_line';

export type BoundaryDecision = {
  type: BoundaryDecisionType;
  confidence: number;
  gapPx: number;
  gapByChar: number;
  thresholdByChar: number;
};

export type BoundaryClassifierContext = {
  profile: ClassifierProfile;
  resolvedScript: TextScript;
};

export interface BoundaryClassifier {
  classify(
    prev: NormalizedGlyphItem,
    next: NormalizedGlyphItem,
    model: LineGeometryModel,
    ctx: BoundaryClassifierContext
  ): BoundaryDecision;
}

export type ReconstructedLine = {
  text: string;
  decisions: BoundaryDecision[];
};
