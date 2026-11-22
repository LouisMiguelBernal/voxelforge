import { defineConfig } from 'vite'

// Lightweight production config: single static bundle, no external assets.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 900
  },
  server: {
    port: 5173,
    open: true
  }
})
