const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')

const projectRoot = path.resolve(__dirname, '..')
const generatedDevDirectory = path.resolve(projectRoot, '.next', 'dev')
const expectedParent = path.resolve(projectRoot, '.next')
const generatedDevTypesDirectory = path.resolve(generatedDevDirectory, 'types')
const generatedDevAppTypesDirectory = path.resolve(generatedDevDirectory, 'server', 'app')

if (path.dirname(generatedDevDirectory) !== expectedParent) {
  throw new Error(`Refusing to clean unexpected path: ${generatedDevDirectory}`)
}

function isPathInside(parent, target) {
  const relative = path.relative(parent, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function isPortOpen(port) {
  return await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

async function main() {
  for (const target of [generatedDevTypesDirectory, generatedDevAppTypesDirectory]) {
    if (!isPathInside(generatedDevDirectory, target)) {
      throw new Error(`Refusing to clean unexpected path: ${target}`)
    }
  }

  const devServerRunning = await isPortOpen(3000)
  if (devServerRunning) {
    console.log('[prebuild] Skipped cleaning .next/dev generated types because a dev server is running on port 3000')
    return
  }

  fs.rmSync(generatedDevTypesDirectory, { recursive: true, force: true })
  fs.rmSync(generatedDevAppTypesDirectory, { recursive: true, force: true })
  console.log('[prebuild] Cleared generated .next/dev types only')
}

main().catch((error) => {
  console.error('[prebuild] Failed to clean generated dev types', error)
  process.exitCode = 1
})
