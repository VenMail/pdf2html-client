# Library Reference Documentation

This document provides comprehensive reference documentation for all libraries used in the PDF2HTML client library. Use this as a cross-reference for implementation details, API usage, and advanced functionalities.

---

## Table of Contents

1. [@embedpdf/pdfium](#embedpdfpdfium)
2. [pdfjs-dist](#pdfjs-dist)
3. [OCR Implementation](#ocr-implementation)
4. [pdf-lib](#pdf-lib)
5. [Google Fonts API](#google-fonts-api)

---

## @embedpdf/pdfium

### Overview

`@embedpdf/pdfium` provides browser-friendly WebAssembly bindings for Google's PDFium library, exposing low-level `FPDF_*` and `FPDFText_*` APIs. This project uses it as the default high-fidelity backend for text and image object extraction.

**Key Features:**
- Browser-focused WASM distribution
- Low-level PDFium APIs for detailed extraction (text positioning, page objects)
- Suitable for high-fidelity HTML reconstruction workflows

### Installation

```bash
npm install @embedpdf/pdfium
```

### Official Resources

- **Documentation**: [https://www.embedpdf.com/docs/pdfium/introduction](https://www.embedpdf.com/docs/pdfium/introduction)
- **GitHub (examples/viewer)**: [https://github.com/embedpdf/embed-pdf-viewer/](https://github.com/embedpdf/embed-pdf-viewer/)
- **NPM Package**: [https://www.npmjs.com/package/@embedpdf/pdfium](https://www.npmjs.com/package/@embedpdf/pdfium)

### Basic Usage

```typescript
import { init, DEFAULT_PDFIUM_WASM_URL } from '@embedpdf/pdfium';

const wasmBinary = await (await fetch(DEFAULT_PDFIUM_WASM_URL)).arrayBuffer();
const pdfium = await init({ wasmBinary });
pdfium.PDFiumExt_Init();

// Load document from bytes (this project uses malloc + FPDF_LoadMemDocument)
// const doc = pdfium.FPDF_LoadMemDocument(ptr, len, 0);
```

### API Reference

#### Initialization

- `init({ wasmBinary })`: loads the PDFium WASM module and returns a `pdfium` object.
- `pdfium.PDFiumExt_Init()`: must be called once after initialization.

#### Document lifecycle (low-level)

- `FPDF_LoadMemDocument(dataPtr, size, passwordPtr)`: opens a document from bytes.
- `FPDF_GetPageCount(doc)`: page count.
- `FPDF_LoadPage(doc, pageIndex)` / `FPDF_ClosePage(page)`: page lifecycle.
- `FPDF_CloseDocument(doc)`: close document.

#### Text extraction

- `FPDFText_LoadPage(page)` / `FPDFText_ClosePage(textPage)`
- `FPDFText_CountChars(textPage)`
- `FPDFText_GetUnicode(textPage, index)`
- `FPDFText_GetCharBox(textPage, index, left, right, bottom, top)`

#### Image/page object enumeration

- `FPDFPage_CountObjects(page)` / `FPDFPage_GetObject(page, index)`
- `FPDFPageObj_GetType(obj)` (check for image objects)
- `FPDFPageObj_GetBounds(obj, left, bottom, right, top)`

This project currently uses `FPDFImageObj_GetRenderedBitmap(...)` for image previews and will add raw/decoded extraction via `FPDFImageObj_GetImageDataRaw` and `FPDFImageObj_GetImageDataDecoded`.

### Advanced Features

#### Text Extraction with Positioning

```typescript
// If getTextWithPosition is available
const textItems = await page.getTextWithPosition();
textItems.forEach(item => {
  console.log(`Text: ${item.text}`);
  console.log(`Position: (${item.x}, ${item.y})`);
  console.log(`Size: ${item.width}x${item.height}`);
  console.log(`Font: ${item.fontName}, Size: ${item.fontSize}`);
});
```

#### Image Extraction

```typescript
// Iterate objects and select images
for (const object of page.objects()) {
  if (object.type !== 'image') continue;

  // Render image to RGBA bitmap (browser-friendly)
  const rendered = await object.render({ render: 'bitmap' });

  // Or: extract raw uncompressed image data + decoder info
  const raw = object.getImageDataRaw?.();
  // raw.filters can include values such as "DCTDecode" or "FlateDecode"
}
```

#### Extract Raw Image Data vs Encoded Formats

PDF images are not stored as PNG/JPEG containers. They are typically stored as bitmaps with PDF filters (e.g. `DCTDecode`, `FlateDecode`).

- Use `object.getImageDataRaw()` if you need the uncompressed pixel buffer + `filters` metadata.
- Use `object.render(...)` if you want PDFium to decode and give you RGBA (and optionally encode via a custom render function in Node).

#### Metadata Extraction

```typescript
const metadata = await document.getMetadata();
console.log(`Title: ${metadata.title}`);
console.log(`Author: ${metadata.author}`);
console.log(`Creation Date: ${metadata.creationDate}`);
```

### Implementation Notes

- **Initialization**: Initialize once (`PDFiumLibrary.init`) and reuse the instance.
- **Lifecycle**: Always call `document.destroy()` and `library.destroy()` when done.
- **Complex PDFs**:
  - If text is missing, the PDF may be scanned: use OCR.
  - If extraction is wrong, inspect page objects (`page.objects()`) and compare with operator-list output from pdf.js.
  - Be mindful of transparency/soft masks and color spaces; rendering-to-bitmap may be more reliable than raw stream decoding.
- **Coordinate System**: PDFium uses bottom-left origin. Convert to top-left for HTML rendering.
- **Memory Management**: Large PDFs can consume significant wasm memory; avoid holding multiple documents simultaneously.

### Troubleshooting

**Issue**: Library fails to initialize
- **Solution**: Ensure WASM files are accessible. Check browser console for loading errors.

**Issue**: Text extraction returns empty string
- **Solution**: PDF may be image-based. Use OCR instead or check if text is in annotations.

**Issue**: Memory errors with large PDFs
- **Solution**: Process pages individually and dispose of resources after use.

---

## pdfjs-dist

### Overview

`pdfjs-dist` is Mozilla's PDF.js library distributed as an npm package. It enables PDF rendering and text extraction directly in the browser using HTML5 and JavaScript.

**Key Features:**
- Web standards-based PDF rendering
- Text extraction with font information
- Annotation support
- Form handling
- Cross-browser compatibility

### Installation

```bash
npm install pdfjs-dist
```

### Official Resources

- **GitHub Repository**: [https://github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js)
- **Official Website**: [https://pdf.js.org/](https://pdf.js.org/)
- **API Documentation**: [https://mozilla.github.io/pdf.js/api/](https://mozilla.github.io/pdf.js/api/)
- **NPM Package**: [https://www.npmjs.com/package/pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist)
- **Examples**: [https://mozilla.github.io/pdf.js/examples/](https://mozilla.github.io/pdf.js/examples/)

### Basic Usage

```typescript
import * as pdfjsLib from 'pdfjs-dist';

// Configure worker (REQUIRED before use)
pdfjsLib.GlobalWorkerOptions.workerSrc = 
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Or use local worker
// pdfjsLib.GlobalWorkerOptions.workerSrc = '/path/to/pdf.worker.js';

// Load PDF document
const loadingTask = pdfjsLib.getDocument({
  data: pdfArrayBuffer,
  // or url: 'path/to/file.pdf'
});

const pdf = await loadingTask.promise;
console.log(`PDF loaded: ${pdf.numPages} pages`);

// Get metadata
const metadata = await pdf.getMetadata();
console.log('Info:', metadata.info);
console.log('Metadata:', metadata.metadata);

// Load a page (1-indexed)
const page = await pdf.getPage(1);

// Get viewport
const viewport = page.getViewport({ scale: 1.0 });
console.log(`Page size: ${viewport.width}x${viewport.height}`);

// Extract text content
const textContent = await page.getTextContent();
textContent.items.forEach(item => {
  console.log(`Text: ${item.str}`);
  console.log(`Transform: ${item.transform}`);
  console.log(`Font: ${item.fontName}`);
});
```

### API Reference

#### Global Configuration

```typescript
// Set worker source (REQUIRED)
pdfjsLib.GlobalWorkerOptions.workerSrc = string;

// Get library version
const version = pdfjsLib.version;
```

#### getDocument

```typescript
const loadingTask = pdfjsLib.getDocument({
  data: ArrayBuffer | Uint8Array,
  url?: string,
  httpHeaders?: Record<string, string>,
  password?: string,
  verbosity?: number,
  stopAtErrors?: boolean,
  maxImageSize?: number,
  isEvalSupported?: boolean,
  useSystemFonts?: boolean,
  disableFontFace?: boolean,
  disableRange?: boolean,
  disableStream?: boolean,
  disableAutoFetch?: boolean,
  disableCreateObjectURL?: boolean
});

const pdf = await loadingTask.promise;
```

#### PDFDocument

**Properties:**
- `numPages: number` - Total number of pages

**Methods:**

- `getPage(pageNumber: number)`: Get a page (1-indexed)
  - Returns: `Promise<PDFPageProxy>`

- `getMetadata()`: Get document metadata
  - Returns: `Promise<{ info: PDFInfo; metadata: PDFMetadata }>`

- `getOutline()`: Get document outline/bookmarks
  - Returns: `Promise<OutlineItem[] | null>`

- `getAttachments()`: Get document attachments
  - Returns: `Promise<Record<string, Attachment> | null>`

- `getJavaScript()`: Get embedded JavaScript
  - Returns: `Promise<string[] | null>`

- `getDestinations()`: Get named destinations
  - Returns: `Promise<Record<string, any>>`

#### PDFPageProxy

**Methods:**

- `getViewport(options: { scale: number; rotation?: number; offsetX?: number; offsetY?: number })`: Get viewport
  - Returns: `PageViewport`

- `getTextContent()`: Extract text with positioning
  - Returns: `Promise<TextContent>`

- `getOperatorList()`: Get rendering operators
  - Returns: `Promise<OperatorList>`

- `render(renderContext: RenderTaskRenderContext)`: Render page to canvas
  - Returns: `RenderTask`

- `getAnnotations()`: Get page annotations
  - Returns: `Promise<Annotation[]>`

- `getStructTree()`: Get structure tree (accessibility)
  - Returns: `Promise<StructTreeNode | null>`

#### TextContent

```typescript
interface TextContent {
  items: TextItem[];
  styles: Record<string, TextStyle>;
}

interface TextItem {
  str: string;
  transform: number[]; // [a, b, c, d, e, f] - transformation matrix
  width: number;
  height: number;
  dir: string; // 'ltr' | 'rtl'
  fontName?: string;
}

interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontName?: string;
}
```

### Advanced Features

#### Text Extraction with Font Information

```typescript
const textContent = await page.getTextContent();
const fonts = new Map<string, TextStyle>();

textContent.items.forEach(item => {
  if (item.fontName && textContent.styles[item.fontName]) {
    const style = textContent.styles[item.fontName];
    fonts.set(item.fontName, style);
    
    // Parse transform matrix
    const transform = item.transform;
    const x = transform[4]; // e - x translation
    const y = transform[5]; // f - y translation
    // Note: PDF uses bottom-left origin, need to convert
  }
});
```

#### Rendering to Canvas

```typescript
const viewport = page.getViewport({ scale: 2.0 });
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d')!;

canvas.height = viewport.height;
canvas.width = viewport.width;

const renderContext = {
  canvasContext: context,
  viewport: viewport
};

const renderTask = page.render(renderContext);
await renderTask.promise;
```

#### Annotation Extraction

```typescript
const annotations = await page.getAnnotations();
annotations.forEach(annotation => {
  console.log(`Type: ${annotation.subtype}`);
  console.log(`Rect: ${annotation.rect}`);
  
  if (annotation.subtype === 'Link') {
    console.log(`URL: ${annotation.url}`);
  }
  
  if (annotation.subtype === 'Text') {
    console.log(`Content: ${annotation.contents}`);
  }
});
```

#### Form Field Extraction

```typescript
// Form fields are in annotations
const annotations = await page.getAnnotations();
const formFields = annotations.filter(a => 
  ['Widget', 'Text', 'Button', 'CheckBox', 'RadioButton'].includes(a.subtype)
);

formFields.forEach(field => {
  console.log(`Field: ${field.fieldName}`);
  console.log(`Value: ${field.fieldValue}`);
  console.log(`Type: ${field.subtype}`);
});
```

### Implementation Notes

- **Worker Configuration**: Worker source MUST be set before calling `getDocument()`
- **Page Numbering**: PDF.js uses 1-indexed page numbers (not 0-indexed)
- **Transform Matrix**: Text positioning uses 4x4 transformation matrix. Extract x/y from indices 4 and 5
- **Coordinate System**: PDF uses bottom-left origin. Convert: `y = pageHeight - y`
- **Memory**: Large PDFs may require streaming. Use `disableAutoFetch` and `disableStream` options carefully

### Troubleshooting

**Issue**: "Setting up fake worker failed"
- **Solution**: Ensure `GlobalWorkerOptions.workerSrc` is set before loading documents

**Issue**: "Invalid PDF structure"
- **Solution**: Verify PDF file integrity. Some PDFs may be corrupted or encrypted

**Issue**: Text extraction returns empty
- **Solution**: PDF may be image-based. Check if `textContent.items` is empty. Use OCR instead.

**Issue**: Worker version mismatch
- **Solution**: Ensure `pdf.js` and `pdf.worker.js` are the same version

---

## OCR Implementation

### Overview

The OCR implementation uses `onnxruntime-web` and `@techstark/opencv-js` directly, based on PPU-Paddle-OCR architecture. It performs optical character recognition entirely in the browser using ONNX models.

**Key Features:**
- Direct integration with onnxruntime-web for model inference
- OpenCV.js for image preprocessing and postprocessing
- Text detection, recognition, and angle classification
- Based on PPU-Paddle-OCR implementation
- Client-side processing with no server required

### Dependencies

```bash
npm install onnxruntime-web @techstark/opencv-js
```

### Official Resources

- **onnxruntime-web**: [https://www.npmjs.com/package/onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)
- **@techstark/opencv-js**: [https://www.npmjs.com/package/@techstark/opencv-js](https://www.npmjs.com/package/@techstark/opencv-js)
- **PPU-Paddle-OCR**: [https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)

### Basic Usage

```typescript
import { OCREngine } from 'pdf2html-client';

// Initialize OCR engine with model configuration
const ocr = new OCREngine({
  confidenceThreshold: 0.7
});

// Initialize with model URLs or ArrayBuffers
await ocr.initialize({
  det: 'path/to/detection-model.onnx',
  rec: 'path/to/recognition-model.onnx',
  cls: 'path/to/classification-model.onnx', // optional
  dict: 'path/to/character-dictionary.txt'
});

// Perform OCR on image
const imageData = new ImageData(/* ... */);
const results = await ocr.recognize(imageData);

// Results structure
results.forEach(result => {
  console.log(`Text: ${result.text}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Bounding Box: ${JSON.stringify(result.boundingBox)}`);
  
  if (result.words) {
    result.words.forEach(word => {
      console.log(`  Word: ${word.text} (${word.confidence})`);
    });
  }
});
```

### API Reference

#### OCREngine Class

**Constructor:**
```typescript
const ocr = new OCREngine(config?: {
  confidenceThreshold?: number;
  language?: string;
  preprocess?: boolean;
  autoRotate?: boolean;
});
```

**Methods:**

- `initialize(modelConfig?: ModelConfig): Promise<void>` - Initialize OCR engine with model configuration
- `recognize(imageData: ImageData | string): Promise<OCRResult[]>` - Perform OCR recognition on image
- `isInitialized(): boolean` - Check if engine is initialized
- `dispose(): void` - Clean up resources and release models

**Methods:**

- `loadModels()`: Load OCR models
  - Returns: `Promise<void>`
  - Note: First call downloads models, subsequent calls use cache

- `recognize(image: ImageData | string | HTMLImageElement | HTMLCanvasElement)`: Perform OCR
  - Parameters:
    - `image`: Image data in various formats
  - Returns: `Promise<OCRResult[]>`

- `preprocess(image: ImageData)`: Preprocess image (deskewing, denoising)
  - Returns: `Promise<ImageData>`

- `detectRotation(image: ImageData)`: Detect image rotation
  - Returns: `Promise<number>` - Rotation angle in degrees

- `dispose()`: Clean up resources
  - Returns: `void`

#### OCRResult

```typescript
interface OCRResult {
  text: string;
  confidence: number; // 0-1
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  words?: Array<{
    text: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
}
```

### Advanced Features

#### Image Preprocessing

```typescript
// Enable preprocessing for better accuracy
const preprocessed = await ocr.preprocess(imageData);
const results = await ocr.recognize(preprocessed);
```

#### Auto-Rotation

```typescript
// Detect and correct rotation
const rotation = await ocr.detectRotation(imageData);
if (rotation !== 0) {
  // Rotate image (implementation depends on your image utils)
  const corrected = rotateImage(imageData, rotation);
  const results = await ocr.recognize(corrected);
}
```

#### Batch Processing

```typescript
// Process multiple images
const images = [imageData1, imageData2, imageData3];
const allResults = await Promise.all(
  images.map(img => ocr.recognize(img))
);
```

#### Confidence Filtering

```typescript
const results = await ocr.recognize(imageData);
const highConfidence = results.filter(r => r.confidence > 0.8);
```

### Implementation Notes

- **Model Loading**: First initialization downloads models (~10-50MB). Use caching for better UX
- **Performance**: OCR is CPU-intensive. Consider using Web Workers for large images
- **Memory**: Large images consume significant memory. Consider resizing before OCR
- **Language Support**: Default is English. Specify language code for other languages

### Troubleshooting

**Issue**: Models fail to load
- **Solution**: Check network connection. Models are downloaded on first use. Ensure sufficient storage.

**Issue**: Low accuracy
- **Solution**: Preprocess images (deskew, denoise, enhance contrast). Ensure good image quality.

**Issue**: Memory errors
- **Solution**: Resize large images before OCR. Process images sequentially for very large batches.

**Issue**: Slow performance
- **Solution**: Use Web Workers for parallel processing. Consider image resizing for faster processing.

---

## pdf-lib

### Overview

`pdf-lib` is a library for creating and modifying PDF documents. It's used in this project for PDF manipulation, metadata extraction, and structure analysis.

**Key Features:**
- Create PDFs from scratch
- Modify existing PDFs
- Extract and modify metadata
- Form filling
- Text and image embedding

### Installation

```bash
npm install pdf-lib
```

### Official Resources

- **GitHub Repository**: [https://github.com/Hopding/pdf-lib](https://github.com/Hopding/pdf-lib)
- **NPM Package**: [https://www.npmjs.com/package/pdf-lib](https://www.npmjs.com/package/pdf-lib)
- **Documentation**: [https://pdf-lib.js.org/](https://pdf-lib.js.org/)

### Basic Usage

```typescript
import { PDFDocument } from 'pdf-lib';

// Load existing PDF
const pdfBytes = await fetch('document.pdf').then(res => res.arrayBuffer());
const pdfDoc = await PDFDocument.load(pdfBytes);

// Get metadata
const title = pdfDoc.getTitle();
const author = pdfDoc.getAuthor();
const subject = pdfDoc.getSubject();
const creator = pdfDoc.getCreator();
const producer = pdfDoc.getProducer();
const creationDate = pdfDoc.getCreationDate();
const modificationDate = pdfDoc.getModificationDate();

// Get page count
const pageCount = pdfDoc.getPageCount();

// Get a page
const page = pdfDoc.getPage(0);

// Get page dimensions
const { width, height } = page.getSize();

// Save PDF
const modifiedPdfBytes = await pdfDoc.save();
```

### API Reference

#### PDFDocument

**Static Methods:**

- `PDFDocument.create()`: Create new PDF
  - Returns: `Promise<PDFDocument>`

- `PDFDocument.load(bytes: Uint8Array | ArrayBuffer, options?)`: Load existing PDF
  - Parameters:
    - `bytes`: PDF file data
    - `options`: `{ ignoreEncryption?: boolean; capNumbers?: boolean; parseSpeed?: number; throwOnInvalidBytes?: boolean }`
  - Returns: `Promise<PDFDocument>`

**Methods:**

- `getPageCount()`: Get number of pages
  - Returns: `number`

- `getPage(index: number)`: Get page by index (0-based)
  - Returns: `PDFPage`

- `getPages()`: Get all pages
  - Returns: `PDFPage[]`

- Metadata getters:
  - `getTitle()`: `string | undefined`
  - `getAuthor()`: `string | undefined`
  - `getSubject()`: `string | undefined`
  - `getCreator()`: `string | undefined`
  - `getProducer()`: `string | undefined`
  - `getCreationDate()`: `Date | undefined`
  - `getModificationDate()`: `Date | undefined`

- Metadata setters:
  - `setTitle(title: string)`: `void`
  - `setAuthor(author: string)`: `void`
  - `setSubject(subject: string)`: `void`
  - `setCreator(creator: string)`: `void`
  - `setProducer(producer: string)`: `void`
  - `setCreationDate(date: Date)`: `void`
  - `setModificationDate(date: Date)`: `void`

- `save(options?)`: Save PDF to bytes
  - Parameters: `{ useObjectStreams?: boolean; addDefaultPage?: boolean }`
  - Returns: `Promise<Uint8Array>`

#### PDFPage

**Methods:**

- `getSize()`: Get page dimensions
  - Returns: `{ width: number; height: number }`

- `setSize(width: number, height: number)`: Set page size
  - Returns: `void`

- `getRotation()`: Get page rotation
  - Returns: `number` (0, 90, 180, or 270)

- `setRotation(angle: number)`: Set page rotation
  - Returns: `void`

### Advanced Features

#### Form Field Access

```typescript
// Get form fields
const form = pdfDoc.getForm();
const fields = form.getFields();

fields.forEach(field => {
  const type = field.constructor.name;
  const name = field.getName();
  
  if (type === 'PDFTextField') {
    const value = (field as PDFTextField).getText();
    console.log(`Text field "${name}": ${value}`);
  }
  
  if (type === 'PDFCheckBox') {
    const checked = (field as PDFCheckBox).isChecked();
    console.log(`Checkbox "${name}": ${checked}`);
  }
});
```

#### Embedding Fonts

```typescript
// Embed custom font
const fontBytes = await fetch('font.ttf').then(res => res.arrayBuffer());
const customFont = await pdfDoc.embedFont(fontBytes);

// Use font
page.drawText('Hello', {
  x: 50,
  y: 50,
  size: 30,
  font: customFont
});
```

### Implementation Notes

- **Memory**: Loading large PDFs consumes memory. Consider streaming for very large files
- **Encryption**: Encrypted PDFs require password. Use `ignoreEncryption` option carefully
- **Modifications**: Changes are in-memory until `save()` is called

### Troubleshooting

**Issue**: "Invalid PDF structure"
- **Solution**: Verify PDF file integrity. Some PDFs may be corrupted

**Issue**: Memory errors with large PDFs
- **Solution**: Process pages individually or use streaming

---

## Google Fonts API

### Overview

The Google Fonts API provides programmatic access to the Google Fonts library, enabling font discovery, metadata retrieval, and font loading.

**Key Features:**
- Access to 1000+ free fonts
- Font metadata and variants
- Font loading URLs
- Category and subset filtering

### Official Resources

- **API Documentation**: [https://developers.google.com/fonts/docs/developer_api](https://developers.google.com/fonts/docs/developer_api)
- **Google Fonts Website**: [https://fonts.google.com/](https://fonts.google.com/)

### Basic Usage

```typescript
// Fetch all fonts
const response = await fetch(
  'https://www.googleapis.com/webfonts/v1/webfonts?key=YOUR_API_KEY'
);
const data = await response.json();
const fonts = data.items;

// Search fonts
const searchUrl = `https://www.googleapis.com/webfonts/v1/webfonts?key=YOUR_API_KEY&family=${encodeURIComponent('Roboto')}`;
const searchResponse = await fetch(searchUrl);
const searchData = await searchResponse.json();

// Load font CSS
const fontFamily = 'Roboto';
const weights = [400, 700];
const fontUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@${weights.join(';')}&display=swap`;
```

### API Reference

#### Web Fonts API v1

**Endpoint:**
```
GET https://www.googleapis.com/webfonts/v1/webfonts
```

**Query Parameters:**
- `key` (required): API key
- `sort`: Sort order (`alpha`, `date`, `popularity`, `style`, `trending`)
- `family`: Filter by font family name

**Response Structure:**
```typescript
interface GoogleFontsResponse {
  kind: string;
  items: GoogleFont[];
}

interface GoogleFont {
  family: string;
  variants: string[]; // ['100', '300', '400', '700', '900', 'italic', ...]
  subsets: string[]; // ['latin', 'latin-ext', ...]
  category: string; // 'sans-serif' | 'serif' | 'monospace' | 'display' | 'handwriting'
  version: string;
  lastModified: string;
  files: Record<string, string>; // { '400': 'url', '700': 'url', ... }
}
```

### Advanced Features

#### Font Loading

```typescript
// Load font via CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent('Roboto')}:wght@400;700&display=swap`;
document.head.appendChild(link);

// Or use @import in CSS
// @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
```

#### Font Metrics (Advanced)

For accurate font matching, you may need to load fonts and measure metrics:

```typescript
// Load font and measure metrics
const font = new FontFace('Roboto', 'url(https://fonts.gstatic.com/...)');
await font.load();
document.fonts.add(font);

// Measure text
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
ctx.font = '400 16px Roboto';
const metrics = ctx.measureText('Ag');
console.log(`Width: ${metrics.width}`);
console.log(`ActualBoundingBoxAscent: ${metrics.actualBoundingBoxAscent}`);
console.log(`ActualBoundingBoxDescent: ${metrics.actualBoundingBoxDescent}`);
```

### Implementation Notes

- **API Key**: Requires Google Cloud API key. Free tier available with quotas
- **Rate Limiting**: Be mindful of API rate limits. Cache responses when possible
- **Font Loading**: Fonts load asynchronously. Use `font-display: swap` for better UX
- **Fallbacks**: Always provide font fallback chains in CSS

### Troubleshooting

**Issue**: API returns 403 Forbidden
- **Solution**: Verify API key is valid and enabled for Google Fonts API

**Issue**: Fonts not loading
- **Solution**: Check CORS settings. Use `display=swap` for better loading behavior

**Issue**: Font metrics unavailable
- **Solution**: Load font first, then measure. Metrics require font to be loaded in browser

---

## Additional Resources

### WebAssembly (WASM)

- **MDN Documentation**: [https://developer.mozilla.org/en-US/docs/WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)
- **WebAssembly.org**: [https://webassembly.org/](https://webassembly.org/)

### Canvas API

- **MDN Canvas API**: [https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

### Image Processing

- **OpenCV.js**: [https://docs.opencv.org/3.4/d5/d10/tutorial_js_root.html](https://docs.opencv.org/3.4/d5/d10/tutorial_js_root.html)

---

## Version Compatibility

| Library | Version | Last Updated |
|---------|---------|--------------|
| @embedpdf/pdfium | ^1.5.0 | 2025 |
| pdfjs-dist | ^4.0.379 | 2024 |
| onnxruntime-web | ^1.22.0 | [npm](https://www.npmjs.com/package/onnxruntime-web) |
| @techstark/opencv-js | ^4.11.0-release.1 | [npm](https://www.npmjs.com/package/@techstark/opencv-js) |
| pdf-lib | ^1.17.1 | 2024 |

**Note**: Always check npm for the latest versions and breaking changes.

---

## Cross-Reference Checklist

When implementing features, cross-reference this document with:

1. ✅ Official library documentation (links provided above)
2. ✅ GitHub source code for advanced features not in docs
3. ✅ Type definitions in `node_modules/@types/` or library's own types
4. ✅ Example projects and demos in library repositories
5. ✅ Issue trackers for known bugs and workarounds

---

*Last Updated: 2025*
*Maintain this document as libraries are updated*