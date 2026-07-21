const fs = require('fs')
const path = require('path')

function readJpegDimensions(bytes) {
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + length
  }
  return { width: 0, height: 0 }
}

const file = path.join(process.cwd(), 'public', 'assets', 'company_scanner.jpg')
const bytes = fs.readFileSync(file)
console.log('Scanner dimensions:', readJpegDimensions(bytes))
