const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const generatedDevDirectory = path.resolve(projectRoot, '.next', 'dev')
const expectedParent = path.resolve(projectRoot, '.next')

if (path.dirname(generatedDevDirectory) !== expectedParent) {
  throw new Error(`Refusing to clean unexpected path: ${generatedDevDirectory}`)
}

fs.rmSync(generatedDevDirectory, { recursive: true, force: true })
console.log('[prebuild] Cleared generated .next/dev types')
