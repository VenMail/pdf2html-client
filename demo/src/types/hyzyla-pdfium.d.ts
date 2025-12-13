declare global {
  interface Window {
    __GOOGLE_API_KEY__?: string;
    __PDFIUM_WASM_URL__?: string;
    __PDFIUM_WASM_BINARY__?: ArrayBuffer;
  }
}

export {};
