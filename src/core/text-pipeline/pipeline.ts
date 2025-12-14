import type { PDFTextContent } from '../../types/pdf.js';
import { reconstructLine } from './reconstruct.js';
import type { BoundaryClassifier } from './types.js';

export class TextReconstructionPipelineV2 {
  private classifierProfile?: string;
  private classifier?: BoundaryClassifier;

  constructor(options?: { classifierProfile?: string; classifier?: BoundaryClassifier }) {
    this.classifierProfile = options?.classifierProfile;
    this.classifier = options?.classifier;
  }

  reconstructLineText(items: PDFTextContent[]): string {
    const out = reconstructLine(items, {
      classifier: this.classifier,
      profileName: this.classifierProfile
    });
    return out.text;
  }
}
