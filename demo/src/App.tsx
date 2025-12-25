import React, { useEffect, useMemo, useState } from 'react';
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

  const [responsive, setResponsive] = useState(true);
  const [enableFontMapping, setEnableFontMapping] = useState(true);

  const [textRenderMode, setTextRenderMode] = useState<'html' | 'svg'>('svg');
  const [layoutTextLayout, setLayoutTextLayout] = useState<'absolute' | 'smart' | 'flow'>('absolute');

  const [cssIncludeFonts, setCssIncludeFonts] = useState(true);
  const [cssIncludeReset, setCssIncludeReset] = useState(true);
  const [cssIncludePrint, setCssIncludePrint] = useState(true);

  const [parserStrategy, setParserStrategy] = useState<'auto' | 'pdfium' | 'unpdf'>('auto');

  const [semanticPreserveLayout, setSemanticPreserveLayout] = useState(true);
  const [semanticTextLayout, setSemanticTextLayout] = useState<'flow' | 'semantic'>('semantic');
  const [textPipeline, setTextPipeline] = useState<'legacy' | 'v2' | 'smart'>('smart');
  const [textClassifierProfile, setTextClassifierProfile] = useState<string>('latin-default');
  const [textLayoutPasses, setTextLayoutPasses] = useState<1 | 2>(2);
  const [semanticBlockGapFactor, setSemanticBlockGapFactor] = useState<number>(1.8);
  const [semanticHeadingThreshold, setSemanticHeadingThreshold] = useState<number>(1.2);
  const [semanticMaxHeadingLength, setSemanticMaxHeadingLength] = useState<number>(100);

  const [semanticMergeSameStyleLines, setSemanticMergeSameStyleLines] = useState(true);
  const [semanticWhitespacePadding, setSemanticWhitespacePadding] = useState(true);

  const [useFlexboxLayout, setUseFlexboxLayout] = useState(true);

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

  type DemoConfig = {
    outputMode: 'layout' | 'semantic';
    responsive: boolean;
    enableFontMapping: boolean;
    textRenderMode: 'html' | 'svg';
    layoutTextLayout: 'absolute' | 'smart' | 'flow';
    cssIncludeFonts: boolean;
    cssIncludeReset: boolean;
    cssIncludePrint: boolean;
    parserStrategy: 'auto' | 'pdfium' | 'unpdf';
    semanticPreserveLayout: boolean;
    semanticTextLayout: 'flow' | 'semantic';
    textPipeline: 'legacy' | 'v2' | 'smart';
    textClassifierProfile: string;
    textLayoutPasses: 1 | 2;
    semanticBlockGapFactor: number;
    semanticHeadingThreshold: number;
    semanticMaxHeadingLength: number;
    semanticMergeSameStyleLines: boolean;
    semanticWhitespacePadding: boolean;
    useFlexboxLayout: boolean;
    absElementLineHeightFactor: number;
    absRunLineHeightFactor: number;
    absLineHeightFactor: number;
    lineGroupingFontSizeFactor: number;
    layoutAdapterMode: 'none' | 'flex';
    layoutAdapterRowThresholdPx: number;
    layoutAdapterMinGapPx: number;
    layoutAdapterPreserveVerticalGaps: boolean;
    enablePdfiumDebug: boolean;
  };

  const defaultConfig: DemoConfig = {
    outputMode: 'layout',
    responsive: true,
    enableFontMapping: true,
    textRenderMode: 'svg',
    layoutTextLayout: 'absolute',
    cssIncludeFonts: true,
    cssIncludeReset: true,
    cssIncludePrint: true,
    parserStrategy: 'auto',
    semanticPreserveLayout: true,
    semanticTextLayout: 'semantic',
    textPipeline: 'smart',
    textClassifierProfile: 'latin-default',
    textLayoutPasses: 2,
    semanticBlockGapFactor: 1.8,
    semanticHeadingThreshold: 1.2,
    semanticMaxHeadingLength: 100,
    semanticMergeSameStyleLines: true,
    semanticWhitespacePadding: true,
    useFlexboxLayout: true,
    absElementLineHeightFactor: 1.15,
    absRunLineHeightFactor: 1.15,
    absLineHeightFactor: 1.25,
    lineGroupingFontSizeFactor: 0.85,
    layoutAdapterMode: 'none',
    layoutAdapterRowThresholdPx: 8,
    layoutAdapterMinGapPx: 0.5,
    layoutAdapterPreserveVerticalGaps: true,
    enablePdfiumDebug: false
  };

  const fidelityPreset95: DemoConfig = {
    ...defaultConfig,
    outputMode: 'layout',
    responsive: false,
    enableFontMapping: true,
    textRenderMode: 'svg',
    layoutTextLayout: 'absolute',
    parserStrategy: 'auto',
    semanticPreserveLayout: true,
    semanticTextLayout: 'semantic',
    textLayoutPasses: 2,
    textPipeline: 'smart',
    useFlexboxLayout: true,
    semanticMergeSameStyleLines: true,
    semanticWhitespacePadding: true,
    layoutAdapterMode: 'none'
  };

  const cvKnownGoodPreset: DemoConfig = {
    ...defaultConfig,
    outputMode: 'layout',
    responsive: false,
    enableFontMapping: true,
    textRenderMode: 'svg',
    layoutTextLayout: 'absolute',
    parserStrategy: 'auto',
    layoutAdapterMode: 'none'
  };

  const fidelityPresetMax: DemoConfig = {
    ...defaultConfig,
    outputMode: 'layout',
    responsive: false,
    enableFontMapping: true,
    textRenderMode: 'svg',
    layoutTextLayout: 'absolute',
    parserStrategy: 'auto',
    layoutAdapterMode: 'none'
  };

  const demoConfig = useMemo<DemoConfig>(
    () => ({
      outputMode,
      responsive,
      enableFontMapping,
      textRenderMode,
      layoutTextLayout,
      cssIncludeFonts,
      cssIncludeReset,
      cssIncludePrint,
      parserStrategy,
      semanticPreserveLayout,
      semanticTextLayout,
      textPipeline,
      textClassifierProfile,
      textLayoutPasses,
      semanticBlockGapFactor,
      semanticHeadingThreshold,
      semanticMaxHeadingLength,
      semanticMergeSameStyleLines,
      semanticWhitespacePadding,
      useFlexboxLayout,
      absElementLineHeightFactor,
      absRunLineHeightFactor,
      absLineHeightFactor,
      lineGroupingFontSizeFactor,
      layoutAdapterMode,
      layoutAdapterRowThresholdPx,
      layoutAdapterMinGapPx,
      layoutAdapterPreserveVerticalGaps,
      enablePdfiumDebug
    }),
    [
      outputMode,
      responsive,
      enableFontMapping,
      textRenderMode,
      layoutTextLayout,
      cssIncludeFonts,
      cssIncludeReset,
      cssIncludePrint,
      parserStrategy,
      semanticPreserveLayout,
      semanticTextLayout,
      textPipeline,
      textClassifierProfile,
      textLayoutPasses,
      semanticBlockGapFactor,
      semanticHeadingThreshold,
      semanticMaxHeadingLength,
      semanticMergeSameStyleLines,
      semanticWhitespacePadding,
      useFlexboxLayout,
      absElementLineHeightFactor,
      absRunLineHeightFactor,
      absLineHeightFactor,
      lineGroupingFontSizeFactor,
      layoutAdapterMode,
      layoutAdapterRowThresholdPx,
      layoutAdapterMinGapPx,
      layoutAdapterPreserveVerticalGaps,
      enablePdfiumDebug
    ]
  );

  const storageKey = 'pdf2html_demo_config_v2';

  const encodeConfig = (cfg: DemoConfig): string => {
    const json = JSON.stringify(cfg);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const decodeConfig = (encoded: string): DemoConfig | null => {
    try {
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
      const json = decodeURIComponent(escape(atob(base64 + pad)));
      return JSON.parse(json) as DemoConfig;
    } catch {
      return null;
    }
  };

  const applyConfig = (cfg: Partial<DemoConfig>): void => {
    if (cfg.outputMode) setOutputMode(cfg.outputMode);
    if (typeof cfg.responsive === 'boolean') setResponsive(cfg.responsive);
    if (typeof cfg.enableFontMapping === 'boolean') setEnableFontMapping(cfg.enableFontMapping);
    if (cfg.textRenderMode) setTextRenderMode(cfg.textRenderMode);
    if (cfg.layoutTextLayout) setLayoutTextLayout(cfg.layoutTextLayout);
    if (typeof cfg.cssIncludeFonts === 'boolean') setCssIncludeFonts(cfg.cssIncludeFonts);
    if (typeof cfg.cssIncludeReset === 'boolean') setCssIncludeReset(cfg.cssIncludeReset);
    if (typeof cfg.cssIncludePrint === 'boolean') setCssIncludePrint(cfg.cssIncludePrint);
    if (cfg.parserStrategy) setParserStrategy(cfg.parserStrategy);

    if (typeof cfg.semanticPreserveLayout === 'boolean') setSemanticPreserveLayout(cfg.semanticPreserveLayout);
    if (cfg.semanticTextLayout) setSemanticTextLayout(cfg.semanticTextLayout);
    if (cfg.textPipeline) setTextPipeline(cfg.textPipeline);
    if (typeof cfg.textClassifierProfile === 'string') setTextClassifierProfile(cfg.textClassifierProfile);
    if (cfg.textLayoutPasses) setTextLayoutPasses(cfg.textLayoutPasses);

    if (typeof cfg.semanticBlockGapFactor === 'number') setSemanticBlockGapFactor(cfg.semanticBlockGapFactor);
    if (typeof cfg.semanticHeadingThreshold === 'number') setSemanticHeadingThreshold(cfg.semanticHeadingThreshold);
    if (typeof cfg.semanticMaxHeadingLength === 'number') setSemanticMaxHeadingLength(cfg.semanticMaxHeadingLength);

    if (typeof cfg.semanticMergeSameStyleLines === 'boolean') setSemanticMergeSameStyleLines(cfg.semanticMergeSameStyleLines);
    if (typeof cfg.semanticWhitespacePadding === 'boolean') setSemanticWhitespacePadding(cfg.semanticWhitespacePadding);
    if (typeof cfg.useFlexboxLayout === 'boolean') setUseFlexboxLayout(cfg.useFlexboxLayout);

    if (typeof cfg.absElementLineHeightFactor === 'number') setAbsElementLineHeightFactor(cfg.absElementLineHeightFactor);
    if (typeof cfg.absRunLineHeightFactor === 'number') setAbsRunLineHeightFactor(cfg.absRunLineHeightFactor);
    if (typeof cfg.absLineHeightFactor === 'number') setAbsLineHeightFactor(cfg.absLineHeightFactor);
    if (typeof cfg.lineGroupingFontSizeFactor === 'number') setLineGroupingFontSizeFactor(cfg.lineGroupingFontSizeFactor);

    if (cfg.layoutAdapterMode) setLayoutAdapterMode(cfg.layoutAdapterMode);
    if (typeof cfg.layoutAdapterRowThresholdPx === 'number') setLayoutAdapterRowThresholdPx(cfg.layoutAdapterRowThresholdPx);
    if (typeof cfg.layoutAdapterMinGapPx === 'number') setLayoutAdapterMinGapPx(cfg.layoutAdapterMinGapPx);
    if (typeof cfg.layoutAdapterPreserveVerticalGaps === 'boolean') setLayoutAdapterPreserveVerticalGaps(cfg.layoutAdapterPreserveVerticalGaps);

    if (typeof cfg.enablePdfiumDebug === 'boolean') setEnablePdfiumDebug(cfg.enablePdfiumDebug);
  };

  const copyToClipboard = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  };

  const buildShareUrl = (cfg: DemoConfig): string => {
    const url = new URL(window.location.href);
    url.searchParams.set('cfg', encodeConfig(cfg));
    return url.toString();
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get('cfg');
      if (encoded) {
        const decoded = decodeConfig(encoded);
        if (decoded) {
          applyConfig(decoded);
          return;
        }
      }

      const fromStorage = localStorage.getItem(storageKey);
      if (fromStorage) {
        const parsed = JSON.parse(fromStorage) as Partial<DemoConfig>;
        applyConfig(parsed);
      }
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(demoConfig));
    } catch {
      void 0;
    }
  }, [demoConfig]);

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

      const converter = new PDF2HTML({
        enableOCR: false,
        enableFontMapping,
        parserStrategy,
        cssOptions: {
          includeFonts: cssIncludeFonts,
          includeReset: cssIncludeReset,
          includePrint: cssIncludePrint
        },
        htmlOptions: {
          format: 'html+inline-css',
          preserveLayout: outputMode === 'layout' ? true : semanticPreserveLayout,
          responsive,
          darkMode: false,
          imageFormat: 'base64',
          textRenderMode,
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
          ...(outputMode === 'layout'
            ? {
                textLayout: layoutTextLayout
              }
            : {}),
          ...(outputMode === 'semantic'
            ? {
                textLayout: semanticTextLayout,
                includeExtractedText: true,
                textPipeline,
                textLayoutPasses,
                textClassifierProfile,
                useFlexboxLayout,
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

          <div className="config-actions">
            <button
              className="reconvert-button"
              onClick={() => applyConfig(fidelityPreset95)}
              disabled={loading}
            >
              Preset: 95%+ (editable)
            </button>
            <button
              className="reconvert-button"
              onClick={() => applyConfig(cvKnownGoodPreset)}
              disabled={loading}
              title="Matches cv-fidelity: layout + absolute + svg + font mapping"
            >
              Preset: CV (known-good)
            </button>
            <button
              className="reconvert-button"
              onClick={() => applyConfig(fidelityPresetMax)}
              disabled={loading}
              title="Max visual fidelity: positioned layout + SVG text layer"
            >
              Preset: max fidelity (SVG)
            </button>
            <button
              className="reconvert-button"
              onClick={() => applyConfig(defaultConfig)}
              disabled={loading}
            >
              Reset config
            </button>
            <button
              className="reconvert-button"
              onClick={async () => {
                await copyToClipboard(buildShareUrl(demoConfig));
              }}
              disabled={loading}
              title="Copy a link that rehydrates the current tuning settings"
            >
              Copy share link
            </button>
            <button
              className="reconvert-button"
              onClick={async () => {
                await copyToClipboard(JSON.stringify(demoConfig, null, 2));
              }}
              disabled={loading}
              title="Copy current configuration JSON"
            >
              Export config
            </button>
            <button
              className="reconvert-button"
              onClick={() => {
                const raw = window.prompt('Paste config JSON');
                if (!raw) return;
                try {
                  const parsed = JSON.parse(raw) as Partial<DemoConfig>;
                  applyConfig(parsed);
                } catch {
                  window.alert('Invalid JSON');
                }
              }}
              disabled={loading}
              title="Paste a previously exported config JSON"
            >
              Import config
            </button>
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
                  Flexbox layout
                  <select
                    value={useFlexboxLayout ? '1' : '0'}
                    onChange={(e) => setUseFlexboxLayout(e.target.value === '1')}
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
                    onChange={(e) => setTextPipeline(e.target.value as 'legacy' | 'v2' | 'smart')}
                    disabled={loading}
                  >
                    <option value="smart">smart (linguistic)</option>
                    <option value="v2">v2 (geometric)</option>
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
                Responsive
                <select
                  value={responsive ? '1' : '0'}
                  onChange={(e) => setResponsive(e.target.value === '1')}
                  disabled={loading}
                >
                  <option value="1">true</option>
                  <option value="0">false</option>
                </select>
              </label>

              <label className="tuning-field">
                Font mapping
                <select
                  value={enableFontMapping ? '1' : '0'}
                  onChange={(e) => setEnableFontMapping(e.target.value === '1')}
                  disabled={loading}
                >
                  <option value="0">off</option>
                  <option value="1">on</option>
                </select>
              </label>

              <label className="tuning-field">
                Text render mode
                <select
                  value={textRenderMode}
                  onChange={(e) => setTextRenderMode(e.target.value as 'html' | 'svg')}
                  disabled={loading}
                >
                  <option value="html">html</option>
                  <option value="svg">svg (max fidelity)</option>
                </select>
              </label>

              <label className="tuning-field">
                Layout textLayout
                <select
                  value={layoutTextLayout}
                  onChange={(e) => setLayoutTextLayout(e.target.value as 'absolute' | 'smart' | 'flow')}
                  disabled={loading || outputMode !== 'layout'}
                >
                  <option value="absolute">absolute</option>
                  <option value="smart">smart</option>
                  <option value="flow">flow</option>
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

            <div className="tuning-row">
              <label className="tuning-field">
                CSS include fonts
                <select
                  value={cssIncludeFonts ? '1' : '0'}
                  onChange={(e) => setCssIncludeFonts(e.target.value === '1')}
                  disabled={loading}
                >
                  <option value="1">true</option>
                  <option value="0">false</option>
                </select>
              </label>

              <label className="tuning-field">
                CSS include reset
                <select
                  value={cssIncludeReset ? '1' : '0'}
                  onChange={(e) => setCssIncludeReset(e.target.value === '1')}
                  disabled={loading}
                >
                  <option value="1">true</option>
                  <option value="0">false</option>
                </select>
              </label>

              <label className="tuning-field">
                CSS include print
                <select
                  value={cssIncludePrint ? '1' : '0'}
                  onChange={(e) => setCssIncludePrint(e.target.value === '1')}
                  disabled={loading}
                >
                  <option value="1">true</option>
                  <option value="0">false</option>
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

