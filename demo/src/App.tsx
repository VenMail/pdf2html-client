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

  const handleFileUpload = async (file: File) => {
    setPdfFile(file);
    setLoading(true);
    setError(null);
    setHtmlOutput(null);
    setProgress(null);

    try {
      const { PDF2HTML } = await import('../../src/index');
      
      // Get API key from environment
      const apiKey = import.meta.env.GOOGLE_API_KEY;
      if (apiKey) {
        // Make API key available globally for font mapper
        window.__GOOGLE_API_KEY__ = apiKey;
      }

      const converter = new PDF2HTML({
        enableOCR: true,
        enableFontMapping: true,
        htmlOptions: {
          format: 'html+inline-css',
          preserveLayout: true,
          responsive: true,
          darkMode: false,
          imageFormat: 'base64'
        }
      });

      const output = await converter.convert(file, (progress: ConversionProgress) => {
        setProgress(progress);
      });

      setHtmlOutput(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>PDF2HTML Client Demo</h1>
        <p>Convert PDFs to HTML with OCR and font mapping</p>
      </header>

      <main className="app-main">
        <div className="upload-section">
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
            <HTMLOutput output={htmlOutput} />
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

