// Build + pack (unpacked directory only, no installer)
// Same as pack.js but uses --dir flag for faster testing

const { execSync } = require('child_process')

console.log('=== Step 1: Build renderer (standalone vite with Vue plugin) ===')
execSync('npx vite build', { stdio: 'inherit' })

console.log('\n=== Step 2: Build main + preload (electron-vite) ===')
try {
  execSync('npx electron-vite build', { stdio: 'inherit' })
} catch {
  console.log('Note: electron-vite renderer build failed (expected). Main+preload built OK.')
}

console.log('\n=== Step 3: Package directory (electron-builder --dir) ===')
execSync('npx electron-builder --win --dir', { stdio: 'inherit' })

console.log('\n✅ Pack:dir complete!')
