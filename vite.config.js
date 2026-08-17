import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ship a strict CSP in the packaged app. It is injected only for `vite build`,
// because Vite's dev server needs an inline module preamble for React refresh.
const cspOnBuild = () => ({
  name: 'kai-csp-on-build',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<title>',
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'\" />\n    <title>"
    );
  },
});

export default defineConfig({
  plugins: [react(), cspOnBuild()],
  // Relative base so the built index.html works over file:// inside the .app
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
