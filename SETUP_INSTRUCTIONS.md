# Setup Instructions

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

**Note**: If `@siva-sub/client-ocr` installation fails, it's optional. The library works without OCR.

### 2. Configure Google Fonts API Key

#### For Demo Application

Create `demo/.env`:
```env
GOOGLE_API_KEY=your_api_key_here
```

#### For Test Scripts

Create `.env` in project root:
```env
GOOGLE_API_KEY=your_api_key_here
```

**Get API Key**:
1. Go to https://console.cloud.google.com/
2. Create a new project or select existing
3. Enable "Web Fonts Developer API"
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy the API key to your `.env` file

### 3. Run Tests

```bash
# Analyze a specific PDF
npm run analyze-pdf "demo/pdfs/Talent Agreement.pdf"

# Test all PDFs
npm run test:pdfs

# Run unit tests
npm test
```

### 4. Run Demo

```bash
npm run demo
```

Then open http://localhost:5173 in your browser.

## Troubleshooting

### OCR Package Not Found

If `@siva-sub/client-ocr` fails to install:
- It's optional - library works without OCR
- OCR features will be disabled
- Text-based PDFs will still work

### Google Fonts API Key Issues

If font mapping fails:
- Check API key is correct in `.env`
- Verify API is enabled in Google Cloud Console
- Check API quota hasn't been exceeded
- Library will fall back to hardcoded fonts

### Image Extraction Warnings

If you see "No images extracted" warnings:
- This is a known limitation with PDF.js
- PDFium may extract images better
- Consider using OCR for image-based PDFs

### Build Errors

If TypeScript compilation fails:
```bash
npm run type-check
```

Fix any type errors before building.

## Environment Variables

### Required
- None (library works without API key, uses fallbacks)

### Optional
- `GOOGLE_API_KEY` - For Google Fonts API (enables better font mapping)

## Testing Checklist

After setup, verify:

1. ✅ Dependencies installed
2. ✅ `.env` file created with API key
3. ✅ `npm run analyze-pdf` works
4. ✅ `npm run test:pdfs` runs without errors
5. ✅ Demo app loads and can upload PDFs
6. ✅ HTML outputs generated in `test-outputs/`

## Next Steps

1. Test with simple PDF (Talent Agreement.pdf)
2. Test with complex PDF (company_profile.pdf)
3. Verify HTML output quality
4. Check for missing features
5. Report any issues


