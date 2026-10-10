import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 builds one self-contained html file (used for quick previews); default is the normal multi-file site.
const single = process.env.SINGLE === '1';

export default defineConfig({
  base: './',
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  build: {
    outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1800,
    // the chart library and the framework change rarely: in their own files they stay cached across releases and load in parallel with the app
    rollupOptions: single ? undefined : { output: { manualChunks: { charts: ['echarts'], framework: ['react', 'react-dom', 'react-router-dom'] } } },
  },
});
