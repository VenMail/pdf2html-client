declare global {
  interface Window {
    __PDFIUM_WASM_URL__?: string;
    __PDFIUM_WASM_BINARY__?: ArrayBuffer;
  }
}

export {};
