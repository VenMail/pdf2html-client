# Testing Guide

This guide explains how to test the PDF2HTML library with real PDF files.

## Quick Start

### Test All PDFs

```bash
npm run test:pdfs
```

This will:
- Test all PDFs in `demo/pdfs/`
- Generate HTML outputs in `test-outputs/`
- Create a detailed JSON report
- Show success/failure summary

### Analyze a Specific PDF

```bash
npm run analyze-pdf demo/pdfs/company_profile.pdf
```

This will:
- Analyze PDF structure and content
- Identify fonts, images, graphics, forms
- List potential issues
- Generate detailed JSON report

### Run Unit Tests

```bash
npm test
```

### Run Integration Tests

```bash
npm test tests/integration/pdf-test-suite.ts
```

## Test PDFs

The following PDFs are available for testing:

1. **Talent Agreement.pdf** (Simple)
   - 1 page
   - Text-based
   - Good for basic functionality testing

2. **PermitOutcome_440112 (1).pdf** (Medium)
   - 1 page
   - Contains images including QR code
   - Tests image extraction

3. **03.pdf** (Medium)
   - 15 pages
   - Contains images and graphics
   - Tests multi-page processing

4. **company_profile.pdf** (Complex)
   - 24 pages
   - Complex charts, SVG, images
   - Tests advanced features and performance

## Test Outputs

All test outputs are saved to `test-outputs/`:

- `*.html` - Generated HTML files
- `*.css` - Generated CSS files
- `test-report.json` - Test results summary
- `*-analysis.json` - PDF analysis reports

## Understanding Test Results

### Success Indicators

- ✓ PDF parsed successfully
- ✓ HTML generated
- ✓ Text extracted
- ✓ Images extracted (if present)
- ✓ Fonts mapped
- ✓ Processing time reasonable

### Failure Indicators

- ✗ Parsing errors
- ✗ Empty HTML output
- ✗ Missing text/images
- ✗ Memory errors
- ✗ Timeout errors

## Performance Benchmarks

Expected processing times:

- Simple PDF (1 page): < 5 seconds
- Medium PDF (1-15 pages): < 30 seconds
- Complex PDF (24 pages): < 2 minutes

If processing takes longer, check:
- Browser console for errors
- Memory usage
- Network issues (for OCR models)

## Debugging Failed Tests

### Check Logs

Test scripts output detailed logs:
- Processing stages
- Error messages
- Performance metrics

### Analyze PDF Structure

```bash
npm run analyze-pdf <pdf-path>
```

This helps identify:
- Missing text (may need OCR)
- Unsupported features (graphics, forms)
- Font issues
- Layout problems

### Common Issues

1. **No text extracted**
   - PDF may be scanned - enable OCR
   - Check if PDF has text layer

2. **Images missing**
   - Image extraction may not be fully implemented
   - Check `IMPLEMENTATION_REVIEW.md`

3. **Font mapping fails**
   - Google Fonts API key may be missing
   - Check `CRITICAL_FIXES.md`

4. **Memory errors**
   - PDF too large
   - Check memory limits in config

5. **Timeout errors**
   - Increase timeout in test config
   - Check for infinite loops

## Continuous Testing

### Watch Mode

```bash
npm test -- --watch
```

### Coverage

```bash
npm run test:coverage
```

### UI Mode

```bash
npm run test:ui
```

## Adding New Test PDFs

1. Add PDF to `demo/pdfs/`
2. Update `testPDFs` array in `scripts/test-pdfs.ts`
3. Update `testPDFs` array in `tests/integration/pdf-test-suite.ts`
4. Run tests: `npm run test:pdfs`

## Test Coverage Goals

- [ ] All PDF types (text, scanned, mixed)
- [ ] All page counts (1, 5, 15, 24+)
- [ ] All features (text, images, graphics, forms)
- [ ] Error cases (corrupted PDFs, invalid data)
- [ ] Performance (memory, speed)
- [ ] Edge cases (empty PDFs, single page, etc.)

## Reporting Issues

When reporting test failures, include:

1. PDF file name
2. Test output/logs
3. Error messages
4. Browser/Node version
5. System specs (if memory-related)


