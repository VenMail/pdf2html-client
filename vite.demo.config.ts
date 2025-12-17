import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { createRequire } from 'module';

export default defineConfig(() => {
  const ensurePdfiumWasmPlugin = () => {
    const require = createRequire(import.meta.url);
    return {
      name: 'ensure-pdfium-wasm',
      configureServer() {
        const demoPublicDir = resolve(__dirname, 'demo', 'public');
        const outPath = resolve(demoPublicDir, 'pdfium.wasm');
        if (existsSync(outPath)) return;

        try {
          mkdirSync(demoPublicDir, { recursive: true });
        } catch {
          // ignore
        }

        try {
          let srcPath: string | null = null;
          try {
            srcPath = require.resolve('@embedpdf/pdfium/dist/pdfium.wasm');
          } catch {
            srcPath = null;
          }

          if (!srcPath) {
            srcPath = resolve(__dirname, 'node_modules', '@embedpdf', 'pdfium', 'dist', 'pdfium.wasm');
          }

          if (!existsSync(srcPath)) {
            console.warn(`PDFium wasm not found at ${srcPath}`);
            return;
          }

          copyFileSync(srcPath, outPath);
        } catch {
          console.warn('Failed to copy PDFium wasm into demo/public');
        }
      }
    };
  };
  
  return {
    plugins: [ensurePdfiumWasmPlugin(), react()],
    root: './demo',
    build: {
      outDir: '../dist-demo'
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        // Allow importing from src from demo
        '~': resolve(__dirname, 'src')
      }
    },
    optimizeDeps: {
      exclude: ['@embedpdf/pdfium'],
      include: ['unpdf'],
      force: true
    },
    server: {
      port: 5173,
      host: true, // Allow external connections for Playwright
      strictPort: false, // Fall back to next available port if 5173 is in use
      fs: {
        allow: [resolve(__dirname)]
      }
    }
  };
});
