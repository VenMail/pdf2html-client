import React, { useEffect, useMemo } from 'react';

interface PDFViewerProps {
  file: File;
}

export default function PDFViewer({ file }: PDFViewerProps) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <div className="pdf-viewer">
      <iframe src={url} title="PDF Viewer" className="pdf-iframe" />
    </div>
  );
}


