/**
 * What a file really is, from its first bytes. Client-safe and pure.
 *
 * ⚠️ `File.type` is whatever the sender says it is. Every other upload route in this repo trusts it; H Promise
 * does not. An HTML page renamed `pan.jpg` and served back from storage is a script on our domain — so the
 * server stores a file only when its CONTENT is one of the four types below, whatever the header claimed.
 */

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return null
}

export function extensionForSniffedType(type: SniffedType): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'application/pdf':
      return 'pdf'
  }
}

export function isImageType(type: SniffedType): boolean {
  return type !== 'application/pdf'
}
