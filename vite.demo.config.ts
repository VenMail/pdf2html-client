import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
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
      exclude: ['@hyzyla/pdfium']
    },
    define: {
      // Make env variables available in client code
      'import.meta.env.GOOGLE_API_KEY': JSON.stringify(env.GOOGLE_API_KEY || '')
    },
    server: {
      port: 5173,
      host: true, // Allow external connections for Playwright
    }
  };
});
