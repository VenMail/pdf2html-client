import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

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
      external: ['react', 'react-dom', '@hyzyla/pdfium'],
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
    exclude: ['@hyzyla/pdfium']
  },
  worker: {
    format: 'es'
  },
  plugins: [
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


