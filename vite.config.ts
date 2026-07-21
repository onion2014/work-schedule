import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Standalone renderer Vite config (used for dev server and production build)
// electron-vite's renderer config doesn't apply the Vue plugin correctly,
// so we use this separate config instead.

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',  // Use relative paths for Electron file:// protocol
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true
  }
})
