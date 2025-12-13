/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly GOOGLE_API_KEY?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
