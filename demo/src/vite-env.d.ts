/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
