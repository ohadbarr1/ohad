import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const commit = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'local'; } })();

// SINGLE=1 builds one self-contained html file (used for quick previews); default is the normal multi-file site.
const single = process.env.SINGLE === '1';

export default defineConfig({
  // clean URLs (/company/harel): assets are addressed from the site root, so a deep route finds them
  base: single ? './' : '/',
  // __HAS_FINDINGS__: the Finding Engine (S2) wrote public/data/findings.json before this build (deploy builds the data first, then the
  // app): without it the page asks for no file at all, so a build without findings logs no 404 (lib/answersLoad.ts useFindings); HAS_FINDINGS=1 forces it on (a test build that adds a fixture)
  define: { __BUILD__: JSON.stringify({ commit, built: new Date().toISOString() }), __HAS_FINDINGS__: JSON.stringify(process.env.HAS_FINDINGS === '1' || existsSync(new URL('./public/data/findings.json', import.meta.url))) },
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  build: {
    outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1800,
    copyPublicDir: process.env.NOPUBLIC !== '1',
    // the chart library and the framework change rarely: in their own files they stay cached across releases and load in parallel with the app
    rollupOptions: single ? undefined : { output: { manualChunks: { charts: ['echarts'], framework: ['react', 'react-dom', 'react-router-dom'] } } },
  },
});
