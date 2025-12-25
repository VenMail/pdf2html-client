# pdf2html-client

[![npm version](https://badge.fury.io/js/pdf2html-client.svg)](https://badge.fury.io/js/pdf2html-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)

Advanced client-side PDF to HTML converter with WASM parsing, OCR support, and intelligent text layout reconstruction. Perfect for document management systems and web applications.

## Key Features

 This library was built primarily to support high fidelity PDF/DOCX imports in [Venmail Drive](https://venia.cloud). Most PDF-to-HTML pipelines pick one tradeoff: either pixel-perfect output that is hard to edit, or “flow” output that drifts and overlaps. The goal is to provide a one-stop simple workflow for document imports that works with offline-first applications.

`pdf2html-client` is built around a multi-mode text layout engine:

- **High fidelity when you need it** (absolute/smart positioned text)
- **Editability when you want it** (flow/outline-flow)
- **Semantic structure with layout awareness** (semantic regions + flexbox)
- **Overlap-aware fallbacks** for sensitive areas where reflow would break readability

All of this runs in the browser (via pdfium or unpdf).

## Core capabilities

- **WASM PDF parsing**
  - Primary: PDFium (WebAssembly)
  - Fallback/alternative: `unpdf`
  - Select via `parserStrategy: 'auto' | 'pdfium' | 'unpdf'`
- **Multiple text layout modes** (see below)
- **Optional OCR for scanned PDFs**
  - Uses `onnxruntime-web` + OpenCV.js
  - Automatically detects scanned PDFs and only runs OCR when it makes sense
- **Font detection + mapping**
  - Detects fonts from extracted text
  - Maps fonts using an internal font catalog
- **Output formats**
  - `html`, `css`, plus metadata (processing time, page count, OCR used, font mappings, image stats)

## Installation

```bash
pnpm add pdf2html-client
```

### OCR models (optional)

If you enable OCR, you should download the lightweight OCR models ahead of time:

```bash
pnpm run download-models
```

This downloads models into `models/`.

## Quick start

```ts
import { PDF2HTML } from 'pdf2html-client';

const converter = new PDF2HTML({
  enableOCR: false,
  enableFontMapping: false,
  parserStrategy: 'auto',
  htmlOptions: {
    format: 'html+inline-css',
    preserveLayout: true,
    responsive: false,
    darkMode: false,
    imageFormat: 'base64',
    textLayout: 'smart',
    textLayoutPasses: 2,
    textPipeline: 'v2',
    includeExtractedText: true
  }
});

const out = await converter.convert(pdfFile, (p) => {
  console.log(`${p.stage}: ${p.progress}%`);
});

console.log(out.html);
console.log(out.css);
console.log(out.metadata);

converter.dispose();
```

## Output

`convert()` returns an `HTMLOutput`:

- **`html`**: Generated markup
- **`css`**: Generated styles
- **`metadata`**: Page count, processing time, OCR usage, font mapping count, scan detection, and image stats
- **`fonts`**: Font families referenced by output
- **`text`** *(optional)*: Extracted text (when `htmlOptions.includeExtractedText` is enabled)

## Text layout modes

Set `htmlOptions.textLayout`:

### `absolute`

Best for maximum positional fidelity. Produces positioned text elements for precise placement.

### `smart`

Positioned output with additional grouping/merging heuristics to reduce fragmentation while maintaining fidelity.

### `flow`

Two behaviors depending on `htmlOptions.preserveLayout`:

- **`preserveLayout: true`**
  - Produces “outline-flow” HTML that aims to be editable while still matching layout constraints.
- **`preserveLayout: false`**
  - Produces semantic HTML (paragraphs/headings/lists) for maximum reflow/editability.

### `semantic`

Produces semantic regions/lines designed for editing while still anchored to the original PDF layout.

When `preserveLayout: true`, semantic mode renders positioned regions and then uses:

- **Flexbox line layout** (when safe)
- **Automatic fallback to absolute positioning** when overlap risk or sensitive geometry is detected

This is the mode targeted at preventing “vertical overlaps” without losing fidelity.

### `textRenderMode: 'svg'`

For special cases, you can render text through an SVG text layer when `preserveLayout` is enabled.

## Configuration reference

The top-level constructor takes `PDF2HTMLConfig`.

### OCR

- `enableOCR: boolean`
- `ocrConfig?: { confidenceThreshold: number; language?: string; preprocess?: boolean; autoRotate?: boolean }`
- `ocrProcessorOptions?: { batchSize?: number; maxConcurrent?: number; timeout?: number }`

OCR only runs when the document is detected as scanned.

### Font mapping

- `enableFontMapping: boolean`
- `fontMappingOptions?: { strategy: 'exact' | 'similar' | 'fallback'; similarityThreshold: number; cacheEnabled: boolean }`

### Parser

- `parserStrategy?: 'auto' | 'pdfium' | 'unpdf'`
- `parserOptions?: { extractText: boolean; extractImages: boolean; extractGraphics: boolean; extractForms: boolean; extractAnnotations: boolean }`

### HTML generation

`htmlOptions?: HTMLGenerationOptions` (high-level knobs):

- `format: 'html' | 'html+css' | 'html+inline-css'`
- `preserveLayout: boolean`
- `responsive: boolean`
- `darkMode: boolean`
- `imageFormat: 'base64' | 'url'`
- `textLayout?: 'absolute' | 'smart' | 'flow' | 'semantic'`
- `textLayoutPasses?: 1 | 2`
- `textRenderMode?: 'html' | 'svg'`
- `textPipeline?: 'legacy' | 'v2'`
- `includeExtractedText?: boolean`
- `textClassifierProfile?: string`
- `semanticLayout?: { blockGapFactor?: number; headingThreshold?: number; maxHeadingLength?: number }`
- `useFlexboxLayout?: boolean`

### Performance

- `maxConcurrentPages?: number` (default: 4)
- `cacheEnabled?: boolean`
- `wasmMemoryLimit?: number`

## Demo

```bash
pnpm run demo
```

## Testing

```bash
pnpm test
pnpm run test:browser
```

Browser tests are designed to catch layout regressions, especially **text overlaps** in semantic layouts.

## Project structure

```
src/
  core/      PDF parsing + layout analysis
  html/      HTML/CSS generation + layout engines
  fonts/     Font detection + mapping
  ocr/       OCR engine + processing
  types/     Public types
demo/        React demo app
tests/       Unit + browser tests
```

## Roadmap

- Finish PDFJS Fallback
- Add more font mappings
- Better tables (structure + export)
- Richer forms/annotations rendering
- Expanded vector graphics support
- More layout profiles and tuning presets

## License

MIT

