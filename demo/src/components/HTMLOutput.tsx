import React, { useState } from 'react';
import type { HTMLOutput as HTMLOutputType } from '../../../src/types';

interface HTMLOutputProps {
  output: HTMLOutputType;
}

export default function HTMLOutput({ output }: HTMLOutputProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');

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
        <button onClick={() => downloadHTML(output)}>Download HTML</button>
        <button onClick={() => downloadCSS(output)}>Download CSS</button>
      </div>

      {viewMode === 'preview' ? (
        <div
          className="html-preview"
          dangerouslySetInnerHTML={{ __html: output.html }}
        />
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


