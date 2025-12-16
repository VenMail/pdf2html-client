import React, { useState } from 'react';
import PDFUploader from './components/PDFUploader';
import PDFViewer from './components/PDFViewer';
import HTMLOutput from './components/HTMLOutput';
import PDFInspector from './components/inspector/PDFInspector';
import type { HTMLOutput as HTMLOutputType, ConversionProgress } from '../../src/types';
import './components/styles.css';

function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [htmlOutput, setHtmlOutput] = useState<HTMLOutputType | null>(null);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState<'layout' | 'semantic'>('layout');

  const [parserStrategy, setParserStrategy] = useState<'auto' | 'pdfium' | 'unpdf'>('pdfium');

  const [semanticPreserveLayout, setSemanticPreserveLayout] = useState(true);
  const [semanticTextLayout, setSemanticTextLayout] = useState<'flow' | 'semantic'>('semantic');
  const [textPipeline, setTextPipeline] = useState<'legacy' | 'v2'>('v2');
  const [textClassifierProfile, setTextClassifierProfile] = useState<string>('latin-default');
  const [textLayoutPasses, setTextLayoutPasses] = useState<1 | 2>(2);
  const [semanticBlockGapFactor, setSemanticBlockGapFactor] = useState<number>(1.8);
  const [semanticHeadingThreshold, setSemanticHeadingThreshold] = useState<number>(1.2);
  const [semanticMaxHeadingLength, setSemanticMaxHeadingLength] = useState<number>(100);

  const [semanticMergeSameStyleLines, setSemanticMergeSameStyleLines] = useState(true);
  const [semanticWhitespacePadding, setSemanticWhitespacePadding] = useState(true);

  const [absElementLineHeightFactor, setAbsElementLineHeightFactor] = useState<number>(1.15);
  const [absRunLineHeightFactor, setAbsRunLineHeightFactor] = useState<number>(1.15);
  const [absLineHeightFactor, setAbsLineHeightFactor] = useState<number>(1.25);
  const [lineGroupingFontSizeFactor, setLineGroupingFontSizeFactor] = useState<number>(0.85);

  const [layoutAdapterMode, setLayoutAdapterMode] = useState<'none' | 'flex'>('none');
  const [layoutAdapterRowThresholdPx, setLayoutAdapterRowThresholdPx] = useState<number>(8);
  const [layoutAdapterMinGapPx, setLayoutAdapterMinGapPx] = useState<number>(0.5);
  const [layoutAdapterPreserveVerticalGaps, setLayoutAdapterPreserveVerticalGaps] = useState(true);

  const [enablePdfiumDebug, setEnablePdfiumDebug] = useState(false);
  const [pdfiumDebugData, setPdfiumDebugData] = useState<unknown[] | null>(null);
  const [decodeArtifact, setDecodeArtifact] = useState<unknown | null>(null);

  const runConversion = async (file: File) => {
    setLoading(true);
    setError(null);
    setHtmlOutput(null);
    setProgress(null);
    setPdfiumDebugData(null);
    setDecodeArtifact(null);

    try {
      const { PDF2HTML } = await import('../../src/index');

      (window as unknown as { __PDF2HTML_DEBUG_PDFIUM__?: boolean }).__PDF2HTML_DEBUG_PDFIUM__ = enablePdfiumDebug;
      if (enablePdfiumDebug) {
        (window as unknown as { __PDF2HTML_PDFIUM_DEBUG__?: unknown[] }).__PDF2HTML_PDFIUM_DEBUG__ = [];
      }

      (window as unknown as { __PDF2HTML_DEBUG_DECODE__?: boolean }).__PDF2HTML_DEBUG_DECODE__ = true;
      (window as unknown as { __PDF2HTML_DECODE_ARTIFACT__?: unknown }).__PDF2HTML_DECODE_ARTIFACT__ = undefined;

      // Get API key from environment
      const apiKey = import.meta.env.GOOGLE_API_KEY;
      if (apiKey) {
        // Make API key available globally for font mapper
        window.__GOOGLE_API_KEY__ = apiKey;
      }

      const converter = new PDF2HTML({
        enableOCR: true,
        enableFontMapping: true,
        parserStrategy,
        htmlOptions: {
          format: 'html+inline-css',
          preserveLayout: outputMode === 'layout' ? true : semanticPreserveLayout,
          responsive: true,
          darkMode: false,
          imageFormat: 'base64',
          layoutTuning: {
            absElementLineHeightFactor,
            absRunLineHeightFactor,
            absLineHeightFactor,
            lineGroupingFontSizeFactor
          },
          layoutAdapter: {
            mode: layoutAdapterMode,
            rowThresholdPx: layoutAdapterRowThresholdPx,
            minGapPx: layoutAdapterMinGapPx,
            preserveVerticalGaps: layoutAdapterPreserveVerticalGaps
          },
          ...(outputMode === 'semantic'
            ? {
                textLayout: semanticTextLayout,
                includeExtractedText: true,
                textPipeline,
                textLayoutPasses,
                textClassifierProfile,
                semanticLayout: {
                  blockGapFactor: semanticBlockGapFactor,
                  headingThreshold: semanticHeadingThreshold,
                  maxHeadingLength: semanticMaxHeadingLength
                },
                ...(semanticTextLayout === 'semantic'
                  ? {
                      semanticPositionedLayout: {
                        mergeSameStyleLines: semanticMergeSameStyleLines,
                        whitespacePadding: semanticWhitespacePadding
                      }
                    }
                  : {})
              }
            : {})
        }
      });

      const output = await converter.convert(file, (progress: ConversionProgress) => {
        setProgress(progress);
      });

      setHtmlOutput(output);

      if (enablePdfiumDebug) {
        const d = (window as unknown as { __PDF2HTML_PDFIUM_DEBUG__?: unknown[] }).__PDF2HTML_PDFIUM_DEBUG__;
        setPdfiumDebugData(Array.isArray(d) ? d : null);
      }

      const baseArtifact = (window as unknown as { __PDF2HTML_DECODE_ARTIFACT__?: unknown }).__PDF2HTML_DECODE_ARTIFACT__;
      const glyphArtifact = enablePdfiumDebug
        ? (window as unknown as { __PDF2HTML_PDFIUM_DEBUG__?: unknown[] }).__PDF2HTML_PDFIUM_DEBUG__
        : null;
      setDecodeArtifact({
        backend: parserStrategy,
        decoded: baseArtifact ?? null,
        pdfiumGlyphs: Array.isArray(glyphArtifact) ? glyphArtifact : null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setPdfFile(file);
    await runConversion(file);
  };

  const handleReconvert = async () => {
    if (!pdfFile || loading) return;
    await runConversion(pdfFile);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>PDF2HTML Client Demo</h1>
        <p>Convert PDFs to HTML with OCR and font mapping</p>
      </header>

      <main className="app-main">
        <div className="upload-section">
          <div className="conversion-options">
            <label className="conversion-option">
              <input
                type="radio"
                name="outputMode"
                value="layout"
                checked={outputMode === 'layout'}
                onChange={() => setOutputMode('layout')}
                disabled={loading}
              />
              Preserve layout
            </label>
            <label className="conversion-option">
              <input
                type="radio"
                name="outputMode"
                value="semantic"
                checked={outputMode === 'semantic'}
                onChange={() => setOutputMode('semantic')}
                disabled={loading}
              />
              Semantic flow
            </label>
          </div>

          {outputMode === 'semantic' && (
            <div className="conversion-tuning">
              <div className="tuning-row">
                <label className="tuning-field">
                  Layout mode
                  <select
                    value={semanticTextLayout}
                    onChange={(e) => setSemanticTextLayout(e.target.value as 'flow' | 'semantic')}
                    disabled={loading}
                  >
                    <option value="semantic">Positioned semantic (recommended)</option>
                    <option value="flow">Flow semantic</option>
                  </select>
                </label>

                <label className="tuning-field">
                  Preserve layout
                  <select
                    value={semanticPreserveLayout ? '1' : '0'}
                    onChange={(e) => setSemanticPreserveLayout(e.target.value === '1')}
                    disabled={loading}
                  >
                    <option value="1">true</option>
                    <option value="0">false</option>
                  </select>
                </label>

                <label className="tuning-field">
                  Merge same-style lines
                  <select
                    value={semanticMergeSameStyleLines ? '1' : '0'}
                    onChange={(e) => setSemanticMergeSameStyleLines(e.target.value === '1')}
                    disabled={loading || semanticTextLayout !== 'semantic'}
                  >
                    <option value="1">true</option>
                    <option value="0">false</option>
                  </select>
                </label>

                <label className="tuning-field">
                  Whitespace padding
                  <select
                    value={semanticWhitespacePadding ? '1' : '0'}
                    onChange={(e) => setSemanticWhitespacePadding(e.target.value === '1')}
                    disabled={loading || semanticTextLayout !== 'semantic'}
                  >
                    <option value="1">true</option>
                    <option value="0">false</option>
                  </select>
                </label>

                <label className="tuning-field">
                  Text pipeline
                  <select
                    value={textPipeline}
                    onChange={(e) => setTextPipeline(e.target.value as 'legacy' | 'v2')}
                    disabled={loading}
                  >
                    <option value="v2">v2</option>
                    <option value="legacy">legacy</option>
                  </select>
                </label>

                <label className="tuning-field">
                  Classifier profile
                  <input
                    value={textClassifierProfile}
                    onChange={(e) => setTextClassifierProfile(e.target.value)}
                    disabled={loading}
                  />
                </label>
              </div>

              <div className="tuning-row">
                <label className="tuning-field">
                  Layout passes
                  <select
                    value={String(textLayoutPasses)}
                    onChange={(e) => setTextLayoutPasses((Number(e.target.value) as 1 | 2) || 1)}
                    disabled={loading}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </label>

                <label className="tuning-field">
                  Block gap factor
                  <input
                    type="number"
                    step="0.05"
                    value={semanticBlockGapFactor}
                    onChange={(e) => setSemanticBlockGapFactor(Number(e.target.value))}
                    disabled={loading}
                  />
                </label>

                <label className="tuning-field">
                  Heading threshold
                  <input
                    type="number"
                    step="0.05"
                    value={semanticHeadingThreshold}
                    onChange={(e) => setSemanticHeadingThreshold(Number(e.target.value))}
                    disabled={loading}
                  />
                </label>

                <label className="tuning-field">
                  Max heading length
                  <input
                    type="number"
                    step="1"
                    value={semanticMaxHeadingLength}
                    onChange={(e) => setSemanticMaxHeadingLength(Number(e.target.value))}
                    disabled={loading}
                  />
                </label>
              </div>
            </div>
          )}

          <div className="conversion-tuning">
            <div className="tuning-row">
              <label className="tuning-field">
                Parser strategy
                <select
                  value={parserStrategy}
                  onChange={(e) => setParserStrategy(e.target.value as 'auto' | 'pdfium' | 'unpdf')}
                  disabled={loading}
                >
                  <option value="auto">auto</option>
                  <option value="pdfium">pdfium</option>
                  <option value="unpdf">unpdf</option>
                </select>
              </label>

              <label className="tuning-field">
                absElementLineHeightFactor
                <input
                  type="number"
                  step="0.01"
                  value={absElementLineHeightFactor}
                  onChange={(e) => setAbsElementLineHeightFactor(Number(e.target.value))}
                  disabled={loading}
                />
              </label>

              <label className="tuning-field">
                absRunLineHeightFactor
                <input
                  type="number"
                  step="0.01"
                  value={absRunLineHeightFactor}
                  onChange={(e) => setAbsRunLineHeightFactor(Number(e.target.value))}
                  disabled={loading}
                />
              </label>

              <label className="tuning-field">
                absLineHeightFactor
                <input
                  type="number"
                  step="0.01"
                  value={absLineHeightFactor}
                  onChange={(e) => setAbsLineHeightFactor(Number(e.target.value))}
                  disabled={loading}
                />
              </label>

              <label className="tuning-field">
                lineGroupingFontSizeFactor
                <input
                  type="number"
                  step="0.01"
                  value={lineGroupingFontSizeFactor}
                  onChange={(e) => setLineGroupingFontSizeFactor(Number(e.target.value))}
                  disabled={loading}
                />
              </label>
            </div>

            <div className="tuning-row">
              <label className="tuning-field">
                Layout adapter
                <select
                  value={layoutAdapterMode}
                  onChange={(e) => setLayoutAdapterMode(e.target.value as 'none' | 'flex')}
                  disabled={loading}
                >
                  <option value="none">none</option>
                  <option value="flex">flex</option>
                </select>
              </label>

              <label className="tuning-field">
                rowThresholdPx
                <input
                  type="number"
                  step="1"
                  value={layoutAdapterRowThresholdPx}
                  onChange={(e) => setLayoutAdapterRowThresholdPx(Number(e.target.value))}
                  disabled={loading || layoutAdapterMode !== 'flex'}
                />
              </label>

              <label className="tuning-field">
                minGapPx
                <input
                  type="number"
                  step="0.1"
                  value={layoutAdapterMinGapPx}
                  onChange={(e) => setLayoutAdapterMinGapPx(Number(e.target.value))}
                  disabled={loading || layoutAdapterMode !== 'flex'}
                />
              </label>

              <label className="tuning-field">
                preserveVerticalGaps
                <select
                  value={layoutAdapterPreserveVerticalGaps ? '1' : '0'}
                  onChange={(e) => setLayoutAdapterPreserveVerticalGaps(e.target.value === '1')}
                  disabled={loading || layoutAdapterMode !== 'flex'}
                >
                  <option value="1">true</option>
                  <option value="0">false</option>
                </select>
              </label>

              <label className="tuning-field">
                PDFium debug
                <select
                  value={enablePdfiumDebug ? '1' : '0'}
                  onChange={(e) => setEnablePdfiumDebug(e.target.value === '1')}
                  disabled={loading}
                >
                  <option value="0">off</option>
                  <option value="1">on</option>
                </select>
              </label>
            </div>
          </div>

          <div className="conversion-actions">
            <button
              className="reconvert-button"
              onClick={handleReconvert}
              disabled={!pdfFile || loading}
              title="Re-run conversion with current settings"
            >
              Reconvert
            </button>
          </div>

          <PDFUploader onFileSelect={handleFileUpload} disabled={loading} />
          {error && <div className="error-message">{error}</div>}
          {progress && (
            <div className="progress-info">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <p>
                {progress.stage}: {progress.message || `${progress.progress}%`}
                {progress.currentPage !== undefined && progress.totalPages !== undefined && (
                  ` (Page ${progress.currentPage + 1}/${progress.totalPages})`
                )}
              </p>
            </div>
          )}
        </div>

        {htmlOutput && (
          <div className="output-section">
            <HTMLOutput output={htmlOutput} pdfiumDebugData={pdfiumDebugData} decodeArtifact={decodeArtifact} />
          </div>
        )}

        {pdfFile && (
          <div className="output-section">
            <div className="inspector-header">
              <h2>PDF Inspector</h2>
              <p>Debug view for decoded structures via unpdf and pdfium</p>
            </div>
            <div className="inspector-layout">
              <div className="inspector-pane">
                <PDFViewer file={pdfFile} />
              </div>
              <div className="inspector-pane">
                <PDFInspector file={pdfFile} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

