# Browser Testing Guide

This guide explains how to run and use the browser-based test suite for the PDF2HTML client library.

## Overview

The library uses **Playwright** to run tests in a controlled browser environment. This ensures that:
- PDF.js workers work correctly (browser-only feature)
- WASM modules load properly
- All browser APIs are available
- Tests run in a real browser environment

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Install Playwright browsers:**
   ```bash
   pnpm exec playwright install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the project root (or `demo/.env`) with:
   ```
   GOOGLE_API_KEY=your_api_key_here
   ```

## Running Tests

### PDF Conversion Tests

Test the full PDF to HTML conversion pipeline:

```bash
# Run all conversion tests
pnpm run test:pdfs

# Run with browser visible (headed mode)
pnpm run test:pdfs:headed

# Run in debug mode (step through tests)
pnpm run test:pdfs:debug
```

### PDF Analysis Tests

Analyze PDF structure and content:

```bash
pnpm run analyze-pdf
```

### All Browser Tests

```bash
# Run all browser tests
pnpm run test:browser

# Run with UI mode (interactive)
pnpm run test:browser:ui
```

## Test Structure

### Test Harness

The tests use a special test harness page (`demo/test-harness.html`) that:
- Loads the PDF2HTML library
- Makes it available globally for tests
- Provides a clean environment for testing

### Test Files

- **`tests/browser/pdf-conversion.spec.ts`**: Tests PDF to HTML conversion
  - Tests all sample PDFs (simple, mixed, multi-page, complex)
  - Validates page count, text extraction, image extraction
  - Tests progress callbacks
  - Tests error handling

- **`tests/browser/pdf-analysis.spec.ts`**: Tests PDF analysis
  - Analyzes PDF structure
  - Extracts metadata
  - Identifies fonts, images, graphics

### Test Results

Test results are saved to:
- **`test-outputs/browser-test-report.json`**: Detailed JSON report
- **`test-results/results.json`**: Playwright JSON report
- **`test-results/`**: HTML report (open `index.html` in browser)

## Sample PDFs Tested

The test suite includes tests for:

1. **Talent Agreement.pdf** (2 pages, simple text)
2. **PermitOutcome_440112 (1).pdf** (1 page, mixed content with QR code)
3. **03.pdf** (15 pages, multi-page document)
4. **company_profile.pdf** (24 pages, complex with charts and images)

## Configuration

### Playwright Config (`playwright.config.ts`)

- **Base URL**: `http://localhost:5173` (Vite dev server)
- **Browsers**: Chromium (default)
- **Web Server**: Automatically starts `pnpm run demo` before tests
- **Retries**: 2 retries on CI, 0 locally
- **Screenshots**: Captured on failure

### Vite Config (`vite.demo.config.ts`)

- **Port**: 5173
- **Host**: Enabled for Playwright connections
- **Environment**: Loads `.env` variables
- **Module Resolution**: Configured for TypeScript imports

## Troubleshooting

### Tests fail to start

- Ensure Vite dev server can start: `pnpm run demo`
- Check that port 5173 is available
- Verify Playwright browsers are installed: `pnpm exec playwright install`

### PDF.js worker errors

- The library automatically configures workers for browser environments
- Workers use CDN fallback if local worker isn't available
- Check browser console for worker loading errors

### Library not loading

- Check that `demo/test-harness.html` is accessible
- Verify Vite is serving files from `demo/` directory
- Check browser console for import errors

### Environment variables not available

- Ensure `.env` file exists in project root or `demo/` directory
- Restart Vite dev server after changing `.env`
- Check that `GOOGLE_API_KEY` is set (optional, but needed for font mapping)

## CI/CD Integration

The test suite is configured for CI environments:

- **Retries**: 2 retries on CI
- **Workers**: 1 worker on CI (sequential execution)
- **Forbid only**: Prevents `test.only()` in CI
- **Trace**: Captured on first retry

Example GitHub Actions workflow:

```yaml
- name: Install dependencies
  run: pnpm install

- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps

- name: Run browser tests
  run: pnpm run test:browser
```

## Advanced Usage

### Running specific tests

```bash
# Run a specific test file
pnpm exec playwright test tests/browser/pdf-conversion.spec.ts

# Run tests matching a pattern
pnpm exec playwright test -g "should convert"

# Run in specific browser
pnpm exec playwright test --project=chromium
```

### Debugging

1. **Use headed mode:**
   ```bash
   pnpm run test:pdfs:headed
   ```

2. **Use debug mode:**
   ```bash
   pnpm run test:pdfs:debug
   ```

3. **Use Playwright Inspector:**
   ```bash
   PWDEBUG=1 pnpm run test:pdfs
   ```

4. **Add breakpoints:**
   ```typescript
   await page.pause(); // Pauses execution
   ```

### Custom Test Configuration

Modify `playwright.config.ts` to:
- Add more browsers (Firefox, WebKit)
- Change timeouts
- Configure different base URLs
- Add custom reporters

## Test Results Format

The custom reporter generates a JSON report with:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 1,
    "skipped": 1,
    "duration": 5000
  },
  "tests": [
    {
      "title": "should convert Talent Agreement.pdf",
      "status": "passed",
      "duration": 500,
      "results": { ... }
    }
  ]
}
```

## Next Steps

- Add visual regression tests
- Add performance benchmarks
- Test OCR functionality
- Test font mapping accuracy
- Add accessibility tests


