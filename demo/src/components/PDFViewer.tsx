import React from 'react';

interface PDFViewerProps {
  file: File;
}

export default function PDFViewer({ file }: PDFViewerProps) {
  const url = URL.createObjectURL(file);

  return (
    <div className="pdf-viewer">
      <iframe src={url} title="PDF Viewer" className="pdf-iframe" />
    </div>
  );
}


