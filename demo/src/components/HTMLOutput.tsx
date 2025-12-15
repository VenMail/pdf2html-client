import React, { useMemo, useState } from 'react';
import type { HTMLOutput as HTMLOutputType } from '../../../src/types';

interface HTMLOutputProps {
  output: HTMLOutputType;
  pdfiumDebugData?: unknown[] | null;
  decodeArtifact?: unknown | null;
}

export default function HTMLOutput({ output, pdfiumDebugData, decodeArtifact }: HTMLOutputProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [showOverlays, setShowOverlays] = useState(false);
  const [showDecodeArtifact, setShowDecodeArtifact] = useState(false);

  const previewHtml = useMemo(() => {
    if (showDecodeArtifact) {
      const json = (() => {
        try {
          const payload = decodeArtifact ?? { pdfiumGlyphs: pdfiumDebugData ?? null };
          return JSON.stringify(payload ?? null, null, 2);
        } catch {
          return 'Failed to stringify decode artifact';
        }
      })();

      const safe = json
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Decode Artifact</title>
  <style>
    body { margin: 0; padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.4; }
  </style>
</head>
<body>
  <pre>${safe}</pre>
</body>
</html>`;
    }

    return withOverlays(output.html, showOverlays);
  }, [decodeArtifact, output.html, pdfiumDebugData, showDecodeArtifact, showOverlays]);

  return (
    <div className="html-output">
      <div className="output-controls">
        <button
          className={viewMode === 'preview' ? 'active' : ''}
          onClick={() => setViewMode('preview')}
        >
          Preview
        </button>
        <button
          className={viewMode === 'source' ? 'active' : ''}
          onClick={() => setViewMode('source')}
        >
          Source
        </button>
        <button
          className={showOverlays ? 'active' : ''}
          onClick={() => setShowOverlays((v) => !v)}
          disabled={viewMode !== 'preview' || showDecodeArtifact}
          title="Show semantic layout overlays (regions/lines)"
        >
          Overlays
        </button>
        <button
          className={showDecodeArtifact ? 'active' : ''}
          onClick={() => setShowDecodeArtifact((v) => !v)}
          disabled={viewMode !== 'preview'}
          title="View decoded artifact JSON (PDFium or UnPDF/PDF.js depending on selected backend)"
        >
          View decode artifact
        </button>
        <button onClick={() => downloadHTML(output)}>Download HTML</button>
        <button onClick={() => downloadCSS(output)}>Download CSS</button>
      </div>

      {viewMode === 'preview' ? (
        <div className="html-preview">
          <iframe
            className="html-preview-iframe"
            title="HTML Preview"
            sandbox=""
            srcDoc={previewHtml}
          />
        </div>
      ) : (
        <pre className="html-source">
          <code>{output.html}</code>
        </pre>
      )}

      <div className="output-metadata">
        <p>Pages: {output.metadata.pageCount}</p>
        <p>Processing Time: {output.metadata.processingTime}ms</p>
        <p>OCR Used: {output.metadata.ocrUsed ? 'Yes' : 'No'}</p>
        <p>Font Mappings: {output.metadata.fontMappings}</p>
      </div>
    </div>
  );
}

function withOverlays(html: string, enabled: boolean): string {
  if (!enabled) return html;

  const overlayCss = `
<style>
  .pdf-sem-region {
    outline: 2px dashed rgba(255, 0, 0, 0.75) !important;
    outline-offset: -2px;
    background: rgba(255, 0, 0, 0.04) !important;
  }

  .pdf-sem-line {
    outline: 1px dashed rgba(0, 120, 255, 0.85) !important;
    outline-offset: -1px;
    background: rgba(0, 120, 255, 0.03) !important;
  }

  .pdf-sem-region::before {
    content: "region x=" attr(data-x) " top=" attr(data-top) " w=" attr(data-width) " h=" attr(data-height) " flow=" attr(data-flow);
    position: absolute;
    left: 0;
    top: 0;
    transform: translateY(-100%);
    padding: 2px 4px;
    font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    color: rgba(150, 0, 0, 0.95);
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 0, 0, 0.35);
    border-radius: 3px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 999999;
  }
</style>`;

  const headMatch = /<head(\s[^>]*)?>/i.exec(html);
  if (headMatch && typeof headMatch.index === 'number') {
    const insertPos = headMatch.index + headMatch[0].length;
    return html.slice(0, insertPos) + overlayCss + html.slice(insertPos);
  }

  const htmlMatch = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlMatch && typeof htmlMatch.index === 'number') {
    const insertPos = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, insertPos) + `<head>${overlayCss}</head>` + html.slice(insertPos);
  }

  return overlayCss + html;
}

function downloadHTML(output: HTMLOutputType) {
  const blob = new Blob([output.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'output.html';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSS(output: HTMLOutputType) {
  const blob = new Blob([output.css], { type: 'text/css' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'styles.css';
  a.click();
  URL.revokeObjectURL(url);
}


