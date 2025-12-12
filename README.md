# PDF2HTML Client

A modern, client-side PDF parsing library with WASM optimizations, OCR integration, and intelligent font mapping.

## Features

- 🚀 **WASM-Optimized**: High-performance PDF parsing using PDFium compiled to WebAssembly
- 🔍 **OCR Support**: Client-side OCR using onnxruntime-web and OpenCV.js for scanned documents
- 🎨 **Font Mapping**: Automatic detection and mapping to Google Fonts equivalents
- 📄 **Comprehensive Support**: Text, images, vector graphics, forms, and annotations
- ⚡ **Fast & Efficient**: Streaming processing with parallel page handling
- 🎯 **Type-Safe**: Full TypeScript support with comprehensive type definitions
- 🧪 **Well-Tested**: Comprehensive test suite with unit and integration tests
- 🎨 **Modern UI**: Demo application with React

## Installation

```bash
pnpm install pdf2html-client
```

### Download OCR Models

The library uses PPU-Paddle-OCR models for fast, lightweight OCR. Download the required models:

```bash
pnpm run download-models
```

This will download the following models to the `models/` directory:
- `PP-OCRv5_mobile_det_infer.onnx` - Text detection model (~4.8MB)
- `en_PP-OCRv4_mobile_rec_infer.onnx` - Text recognition model (~7.7MB)
- `en_dict.txt` - English character dictionary

**Note**: Models are automatically downloaded on first use if not found locally. For production, it's recommended to download them during build time.

## Quick Start

```typescript
import { PDF2HTML } from 'pdf2html-client';

const converter = new PDF2HTML({
  enableOCR: true,
  enableFontMapping: true,
  preserveLayout: true,
  htmlOptions: {
    format: 'html+inline-css',
    responsive: true,
    darkMode: false
  }
});

// Convert from File
const html = await converter.convert(pdfFile);

// Convert from ArrayBuffer
const html = await converter.convert(pdfArrayBuffer);

// With progress tracking
const html = await converter.convert(pdfFile, (progress) => {
  console.log(`${progress.stage}: ${progress.progress}%`);
});
```

## Configuration

```typescript
interface PDF2HTMLConfig {
  // OCR settings
  enableOCR: boolean;
  ocrConfig?: {
    confidenceThreshold: number;
    language?: string;
    preprocess?: boolean;
    autoRotate?: boolean;
  };

  // Font mapping
  enableFontMapping: boolean;
  fontMappingOptions?: {
    strategy: 'exact' | 'similar' | 'fallback';
    similarityThreshold: number;
    cacheEnabled: boolean;
  };

  // Output options
  htmlOptions?: {
    format: 'html' | 'html+css' | 'html+inline-css';
    preserveLayout: boolean;
    responsive: boolean;
    darkMode: boolean;
    baseUrl?: string;
    imageFormat: 'base64' | 'url';
  };

  // Performance
  maxConcurrentPages?: number;
  wasmMemoryLimit?: number;
  cacheEnabled?: boolean;
}
```

## Development

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm run build
```

### Testing

#### Unit Tests

```bash
pnpm test
pnpm run test:coverage
pnpm run test:ui
```

#### Test with Real PDFs

```bash
# Test all PDFs in demo/pdfs
pnpm run test:pdfs

# Analyze a specific PDF
pnpm run analyze-pdf path-to-sample-pdf
```

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for detailed testing instructions.

### Demo

```bash
pnpm run demo
```

## Project Structure

```
pdf2html-client/
├── src/
│   ├── core/          # PDF parsing (PDFium & pdf.js wrappers)
│   ├── ocr/           # OCR integration
│   ├── fonts/         # Font detection and mapping
│   ├── html/          # HTML generation
│   └── types/         # TypeScript type definitions
├── demo/              # React demo application
├── tests/             # Test suite
└── dist/              # Built output
```

## Architecture

The library follows a modular architecture with clear separation of concerns:

1. **PDF Parsing**: Uses PDFium (WASM) as primary parser with pdf.js fallback
2. **OCR Processing**: Direct OCR implementation using onnxruntime-web and @techstark/opencv-js based on PPU-Paddle-OCR
3. **Font Detection**: Analyzes PDF font dictionaries and metrics
4. **Font Mapping**: Maps detected fonts to Google Fonts equivalents
5. **HTML Generation**: Generates semantic HTML with CSS styling

## Implementation Status

### ✅ Completed
- Project setup and configuration
- Type definitions
- Core PDF parser architecture (PDFium + PDF.js)
- OCR integration
- Font detection and mapping
- HTML generation
- CSS generation
- Layout preservation
- Test suite framework
- Demo application
- Testing tools and scripts

### ⚠️ Known Issues
See [IMPLEMENTATION_REVIEW.md](./IMPLEMENTATION_REVIEW.md) for detailed analysis.

**Critical Issues:**
- OCR results not merged into output
- Image extraction incomplete
- Google Fonts API key required

See [CRITICAL_FIXES.md](./CRITICAL_FIXES.md) for fixes needed.

### 🚧 In Progress / TODO
- Vector graphics conversion (SVG)
- Form field extraction and rendering
- Annotation support
- Enhanced table detection
- Advanced image extraction
- Memory optimization for large PDFs

## Contributing

Contributions are welcome! Please ensure:
- All files stay under 1000 lines
- Code follows TypeScript strict mode
- Tests are included for new features
- Documentation is updated

## License

MIT

