import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname),
  base: './',  // Use relative paths for Electron file:// protocol
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  plugins: [vue()],
  server: {
    port: 5173
  },
  build: {
    outDir: resolve(__dirname, '../../out/renderer')
  }
})
