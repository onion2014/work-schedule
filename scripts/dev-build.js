/**
 * Dev build script — builds only main + preload with electron-vite.
 *
 * electron-vite's renderer build has a known bug where it doesn't apply
 * the vue plugin, so it fails on .vue files. In dev mode, the renderer
 * is served by the standalone vite dev server (port 5173), so we only
 * need main + preload. This script runs electron-vite build and ignores
 * the renderer build failure (same pattern as scripts/build.js).
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.resolve(__dirname, '..')

console.log('Building main + preload for dev...')

try {
  execSync('npx electron-vite build', { stdio: 'inherit', cwd: root })
} catch (e) {
  // electron-vite's renderer build fails (known issue: vue plugin not applied),
  // but main+preload succeed. Check if main+preload output exists.
  const mainOut = path.join(root, 'out/main/index.js')
  const preloadOut = path.join(root, 'out/preload/index.js')

  if (fs.existsSync(mainOut) && fs.existsSync(preloadOut)) {
    console.log('Main + preload built successfully (renderer build failure is expected in dev)')
  } else {
    console.error('Main or preload build failed!')
    process.exit(1)
  }
}
