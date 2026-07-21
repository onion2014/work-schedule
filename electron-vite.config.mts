import { defineConfig } from 'electron-vite'

// Manually specify externals — better-sqlite3 (native CJS module) must NOT be bundled,
// otherwise its dynamic require for the .node binary fails at runtime.
const mainExternals = [
  'electron',
  // native / runtime deps
  'better-sqlite3',
  'dayjs',
  'tyme4ts',
  // Node built-ins
  'path', 'fs', 'crypto', 'os', 'util', 'stream', 'events', 'child_process',
  'net', 'http', 'https', 'url', 'assert', 'buffer', 'querystring', 'string_decoder'
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: mainExternals
      }
    }
  },
  preload: {
    plugins: [] // preload is tiny, no externalization needed
  }
})
