import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PDF2HTML',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['react', 'react-dom', '@embedpdf/pdfium', 'pdfjs-dist'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    },
    sourcemap: true,
    target: 'es2022'
  },
  optimizeDeps: {
    exclude: ['@embedpdf/pdfium']
  },
  worker: {
    format: 'es'
  },
  plugins: [
    dts({
      outDir: 'dist',
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', 'tests', 'demo']
    }),
    {
      name: 'copy-models',
      writeBundle() {
        if (existsSync('models')) {
          try {
            mkdirSync('dist/models', { recursive: true });
            
            const models = [
              'PP-OCRv5_mobile_det_infer.onnx',
              'en_PP-OCRv4_mobile_rec_infer.onnx',
              'en_dict.txt'
            ];
            
            models.forEach(model => {
              if (existsSync(`models/${model}`)) {
                copyFileSync(`models/${model}`, `dist/models/${model}`);
                console.log(`✓ Copied ${model} to dist/models/`);
              }
            });
          } catch (error) {
            console.warn('Failed to copy models:', error);
          }
        }
      }
    }
  ]
});


