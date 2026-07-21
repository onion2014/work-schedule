/**
 * Build script that properly handles renderer, main, and preload builds.
 *
 * The renderer is built by the standalone `vite build` (using vite.config.ts
 * which has the vue plugin), while main+preload are built by electron-vite.
 * electron-vite's renderer build has a known bug where it doesn't apply the
 * vue plugin, so we build the renderer separately first and then use
 * electron-vite only for main+preload.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.resolve(__dirname, '..')

console.log('=== Building Timer 日历 ===')

// Step 1: Build renderer with standalone vite (has vue plugin)
console.log('\n[1/2] Building renderer...')
execSync('npm run build:renderer', { stdio: 'inherit', cwd: root })

// Step 2: Build main+preload with electron-vite
// electron-vite will also try the renderer build (known bug), but since
// vite build already placed the renderer output, we only care about main+preload.
console.log('\n[2/2] Building main + preload...')
try {
  execSync('npm run build:main', { stdio: 'inherit', cwd: root })
} catch (e) {
  // electron-vite's renderer build fails (known issue: vue plugin not applied),
  // but main+preload succeed. Check if main+preload output exists.
  const mainOut = path.join(root, 'out/main/index.js')
  const preloadOut = path.join(root, 'out/preload/index.js')

  if (fs.existsSync(mainOut) && fs.existsSync(preloadOut)) {
    console.log('\nMain + preload built successfully (renderer build failure is a known issue, handled by standalone vite build)')
  } else {
    console.error('\nMain or preload build failed!')
    process.exit(1)
  }
}

console.log('\n=== Build complete ===')
