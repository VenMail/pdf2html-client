import React, { useRef } from 'react';

interface PDFUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export default function PDFUploader({ onFileSelect, disabled }: PDFUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      onFileSelect(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      onFileSelect(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  return (
    <div
      className="pdf-uploader"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        disabled={disabled}
        style={{ display: 'none' }}
      />
      <div className="upload-area">
        <p>Drag and drop a PDF file here, or</p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          Browse Files
        </button>
      </div>
    </div>
  );
}


