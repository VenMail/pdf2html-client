# Critical Fixes Required

This document outlines the critical bugs and gaps that must be fixed before the library can be considered production-ready.

## Priority 1: Must Fix Immediately

### 1. OCR Results Not Merged into Output

**File**: `src/index.ts`
**Issue**: OCR results are processed but never integrated into the document content
**Impact**: Scanned PDFs produce empty HTML output

**Fix**:
```typescript
// After OCR processing (line 104), merge results into document
if (ocrResults) {
  for (const ocrPageResult of ocrResults) {
    const page = document.pages[ocrPageResult.pageNumber];
    if (page) {
      // Convert OCR results to PDFTextContent
      const ocrTextContent = ocrPageResult.results.map(result => ({
        text: result.text,
        x: result.boundingBox.x,
        y: result.boundingBox.y,
        width: result.boundingBox.width,
        height: result.boundingBox.height,
        fontSize: 12, // Estimate or extract from OCR
        fontFamily: 'Arial',
        fontWeight: 400,
        fontStyle: 'normal' as const,
        color: '#000000'
      }));
      
      page.content.text.push(...ocrTextContent);
    }
  }
}
```

### 2. Image Extraction Returns Empty

**File**: `src/core/pdfjs-image-extractor.ts`
**Issue**: `parseImageOperator()` always returns null
**Impact**: No images in HTML output

**Fix**: Implement proper image extraction using PDF.js operator list or alternative method. See library-readme.md for PDF.js image extraction techniques.

### 3. Google Fonts API Key Hardcoded

**File**: `src/fonts/google-fonts-api.ts`
**Issue**: API key placeholder will cause font mapping to fail
**Impact**: Font mapping doesn't work

**Fix**:
```typescript
// Make API key configurable
constructor(private apiKey?: string) {}

async getAllFonts(): Promise<GoogleFont[]> {
  if (!this.apiKey) {
    console.warn('Google Fonts API key not provided, using fallback fonts');
    return this.getFallbackFonts();
  }
  
  const response = await fetch(
    `https://www.googleapis.com/webfonts/v1/webfonts?key=${this.apiKey}`
  );
  // ... rest of implementation
}
```

## Priority 2: Should Fix Soon

### 4. Missing Error Recovery

**File**: `src/core/pdf-parser.ts`
**Issue**: Single page failure stops entire conversion
**Fix**: Add try-catch around individual page parsing, continue with other pages

### 5. No Memory Limits

**File**: Multiple files
**Issue**: Large PDFs can crash browser
**Fix**: Add memory monitoring and limits, implement streaming where possible

### 6. Coordinate Transformation Verification

**File**: `src/html/layout-engine.ts`
**Issue**: Y coordinate transformation may be incorrect
**Fix**: Test with known PDFs and verify positioning accuracy

## Testing Before Fixes

Run these commands to identify current issues:

```bash
# Test all PDFs
npm run test:pdfs

# Analyze specific PDF
npm run analyze-pdf demo/pdfs/company_profile.pdf

# Run unit tests
npm test
```

## After Fixes

1. Re-run test suite
2. Verify all PDFs convert successfully
3. Check HTML output quality
4. Verify images are present
5. Confirm OCR works for scanned PDFs
6. Test with largest PDF (company_profile.pdf)


