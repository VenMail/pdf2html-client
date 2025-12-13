# Implementation Notes

This document outlines the current implementation status and critical information for the PDF2HTML client library.

## Current Status

✅ **COMPLETED**: All core integrations have been implemented. The library is functional with the following components:

- ✅ PDF.js integration with worker configuration
- ✅ PDFium integration (with fallback handling)
- ✅ OCR engine integration
- ✅ Font detection and mapping
- ✅ Font metrics comparison
- ✅ Image conversion utilities
- ✅ Layout detection (tables and columns)
- ✅ HTML generation with CSS

## Implementation Details & Gotchas

### 1. PDFium Integration (`src/core/pdfium-wrapper.ts`)

**Status**: ✅ **COMPLETED**

**Implementation Notes**:
- Uses EmbedPDF PDFium (`@embedpdf/pdfium`) for browser-only WASM PDFium integration
- Uses dynamic import with error handling for graceful fallback
- Extracts metadata including title, author, dates
- **Gotcha**: PDFium library may not be available in all environments - always provide unpdf fallback
- **Gotcha**: PDFium coordinates use bottom-left origin, need conversion to top-left for HTML

**Key Implementation**:
```typescript
const mod = await import('@embedpdf/pdfium');
const pdfium = await mod.init({ wasmBinary });
pdfium.PDFiumExt_Init();
```

### 2. PDF.js Integration (`src/core/pdfjs-wrapper.ts`)

**Status**: ✅ **COMPLETED**

**Implementation Notes**:
- Worker must be configured before use (uses CDN fallback)
- Text extraction includes font information from styles
- Metadata extraction handles various PDF info fields
- **Gotcha**: PDF.js worker source must be set - using CDN as fallback
- **Gotcha**: Page numbers are 1-indexed in PDF.js (not 0-indexed)
- **Gotcha**: Text transform matrix needs careful parsing for accurate positioning

**Key Implementation**:
```typescript
pdfjsLib.GlobalWorkerOptions.workerSrc = 
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```

### 3. OCR Engine Integration (`src/ocr/ocr-engine.ts`)

**Status**: ✅ **COMPLETED**

**Implementation Notes**:
- Dynamic import with clear error messages if library unavailable
- Handles both ImageData and string inputs
- Supports image preprocessing and auto-rotation
- **Gotcha**: OCR library must be installed separately - provide clear error if missing
- **Gotcha**: OCR results format may vary - implemented flexible parsing
- **Gotcha**: Image preprocessing requires canvas API (browser-only)

**Key Implementation**:
```typescript
const ocrModule = await import('@siva-sub/client-ocr').catch(() => null);
if (ocrModule && ocrModule.OCR) {
  this.ocrInstance = new ocrModule.OCR();
  await this.ocrInstance.loadModels();
}
```

### 4. Font Metrics Comparison (`src/fonts/font-metrics.ts`)

**Status**: ✅ **COMPLETED**

**Implementation Notes**:
- Uses estimated metrics based on font category and variant
- Combines name similarity (30%) with metrics similarity (70%)
- Normalizes metrics to 1000 units for comparison
- **Gotcha**: Actual Google Font metrics require font loading - using estimates for performance
- **Gotcha**: Font weight affects width calculations - adjust estimates accordingly
- **Gotcha**: Serif vs sans-serif have different metric patterns

**Key Implementation**:
- Weighted similarity calculation across multiple metrics
- Category-based metric estimation (serif, sans-serif, monospace)
- Name similarity using word matching

### 5. Image Conversion (`src/utils/image-converter.ts`)

**Status**: ✅ **COMPLETED**

**Implementation Notes**:
- Handles both ArrayBuffer and base64 string inputs
- Uses Canvas API for ImageData conversion
- Supports multiple image formats (JPEG, PNG, etc.)
- **Gotcha**: Canvas API only available in browser - needs Node.js alternative for SSR
- **Gotcha**: Large images may cause memory issues - consider size limits
- **Gotcha**: Base64 strings must include proper data URL prefix

**Key Implementation**:
- Canvas-based conversion with proper error handling
- URL.createObjectURL for ArrayBuffer handling
- Automatic cleanup of object URLs

### 6. Layout Detection (`src/html/layout-engine.ts`)

**Status**: ✅ **COMPLETED**

**Implementation Notes**:
- Table detection uses Y-position grouping and X-alignment verification
- Column detection analyzes gaps between text elements
- Generates semantic HTML structures
- **Gotcha**: Table detection requires minimum 2 rows and 2 columns
- **Gotcha**: Alignment tolerance (5px) may need tuning for different PDFs
- **Gotcha**: Column detection may fail on complex layouts with overlapping text

**Key Implementation**:
- Y-position grouping for row detection
- X-position variance calculation for column alignment
- Gap analysis for multi-column layouts

### 7. Advanced Features

**Status**: ⚠️ **PARTIALLY IMPLEMENTED**

**Completed**:
- Basic text and image extraction
- Font mapping and CSS generation
- Table and column detection
- Layout preservation options

**Remaining**:
- Vector graphics to SVG conversion
- Form field extraction and HTML form generation
- Annotation rendering (links, highlights, etc.)
- Multimedia content handling
- Advanced image extraction from PDF.js (operator list parsing)

## Critical Gotchas & Fixes

### 1. PDF.js Worker Configuration
**Issue**: Worker source must be configured before document loading
**Fix**: Initialize worker in wrapper constructor/initialization
**Location**: `src/core/pdfjs-wrapper.ts:initializeWorker()`

### 2. Coordinate System Conversion
**Issue**: PDF uses bottom-left origin, HTML uses top-left
**Fix**: Transform Y coordinates: `y = pageHeight - y`
**Location**: `src/html/layout-engine.ts:transformCoordinates()`

### 3. Font Metrics Estimation
**Issue**: Loading actual Google Font metrics is expensive
**Fix**: Use category-based estimates with name similarity
**Location**: `src/fonts/font-metrics.ts:estimateGoogleFontMetrics()`

### 4. OCR Library Availability
**Issue**: OCR library may not be installed
**Fix**: Graceful error handling with clear messages
**Location**: `src/ocr/ocr-engine.ts:initialize()`

### 5. Image Extraction Limitations
**Issue**: PDF.js image extraction requires operator list parsing
**Fix**: Currently returns empty array - needs full operator list implementation
**Location**: `src/core/pdfjs-image-extractor.ts:extractImages()`
**Status**: ⚠️ Needs enhancement

### 6. Browser-Only APIs
**Issue**: Canvas and Image APIs not available in Node.js
**Fix**: Check for document/window availability
**Location**: Multiple files using canvas/image APIs
**Note**: Consider adding Node.js alternatives for SSR

### 7. Memory Management
**Issue**: Large PDFs can cause memory issues
**Fix**: Implement streaming and page-by-page processing
**Location**: `src/core/pdf-parser.ts:parseParallel()`
**Status**: ✅ Implemented with parallel processing limits

## Testing Requirements

### Sample PDFs Needed

Add test PDFs to `tests/fixtures/sample-pdfs/`:
1. Text-based PDF with standard fonts
2. Scanned image PDF (for OCR testing)
3. Complex layout with tables
4. PDF with form fields
5. PDF with vector graphics
6. Large PDF (>100 pages) for performance
7. Multilingual PDF

### Test Coverage Goals

- Unit tests for each module
- Integration tests for full pipeline
- Performance benchmarks
- Visual regression tests

## Performance Optimizations

1. **WASM Memory Management**: Monitor and optimize WASM memory usage
2. **Parallel Processing**: Ensure proper worker pool implementation
3. **Caching**: Implement persistent caching for:
   - OCR models
   - Font mappings
   - Parsed PDF data
4. **Lazy Loading**: Load resources on-demand

## Browser Compatibility

Test and ensure compatibility with:
- Chrome/Edge (Chromium)
- Firefox
- Safari
- Mobile browsers

## Security Considerations

1. **WASM Security**: Validate WASM modules
2. **Input Validation**: Validate PDF files before processing
3. **Memory Limits**: Implement memory limits for large PDFs
4. **XSS Prevention**: Sanitize HTML output

## Next Steps Priority

1. **High Priority**:
   - Complete PDFium integration
   - Complete pdf.js integration
   - Complete OCR engine integration

2. **Medium Priority**:
   - Font metrics comparison
   - Image conversion
   - Layout detection

3. **Low Priority**:
   - Advanced features (vector graphics, forms, annotations)
   - Performance optimizations
   - Additional test coverage

