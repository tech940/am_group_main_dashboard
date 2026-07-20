/**
 * Unit oracle for lib/images/optimize.ts — proves the two guarantees the upload paths depend on:
 * a real raster shrinks to WebP, and everything else (PDF, garbage, tiny) degrades safely without
 * throwing or growing.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-image-optimize.ts
 */
import 'dotenv/config'
import sharp from 'sharp'
import { optimizeImage } from '../lib/images/optimize'

let passed = 0
let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++
    console.log(`  [PASS] ${msg}`)
  } else {
    failed++
    console.log(`  [FAIL] ${msg}`)
  }
}

// A noisy image so it isn't trivially compressible — makes the JPEG->WebP win realistic.
function noise(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
}

async function main() {
  // 1. A photographic JPEG re-encodes to a smaller, still-decodable WebP.
  const jpeg = await noise(2400, 1600).jpeg({ quality: 95 }).toBuffer()
  const r1 = await optimizeImage(jpeg, 'image/jpeg')
  ok(r1.optimized === true, 'JPEG is optimized')
  ok(r1.contentType === 'image/webp', 'JPEG -> image/webp content-type')
  ok(r1.extension === 'webp', 'JPEG -> .webp extension')
  ok(r1.finalBytes < r1.originalBytes, `JPEG shrank (${r1.originalBytes} -> ${r1.finalBytes} bytes)`)
  ok((await sharp(r1.buffer).metadata()).format === 'webp', 'optimized output decodes as webp')

  // 2. A PDF passes through untouched (same buffer reference, same content-type).
  const pdf = Buffer.from('%PDF-1.4 not a real pdf', 'utf8')
  const r2 = await optimizeImage(pdf, 'application/pdf')
  ok(r2.optimized === false, 'PDF is passthrough (optimized:false)')
  ok(r2.contentType === 'application/pdf', 'PDF content-type preserved')
  ok(r2.extension === 'pdf', 'PDF extension is pdf')
  ok(r2.buffer === pdf, 'PDF buffer returned verbatim')

  // 3. Garbage bytes labelled image/png must NOT throw and must return the original.
  const garbage = Buffer.from('this is definitely not a png', 'utf8')
  let threw = false
  let r3: Awaited<ReturnType<typeof optimizeImage>> | null = null
  try {
    r3 = await optimizeImage(garbage, 'image/png')
  } catch {
    threw = true
  }
  ok(!threw, 'garbage png does not throw')
  ok(r3?.optimized === false, 'garbage png returns passthrough')
  ok(r3?.buffer === garbage, 'garbage png buffer returned verbatim')

  // 4. The document preset keeps a larger max dimension than default.
  const big = await noise(4000, 4000).png().toBuffer()
  const def = await optimizeImage(big, 'image/png', { preset: 'default' })
  const doc = await optimizeImage(big, 'image/png', { preset: 'document' })
  const defW = (await sharp(def.buffer).metadata()).width ?? 0
  const docW = (await sharp(doc.buffer).metadata()).width ?? 0
  ok(defW === 2000, `default preset caps at 2000px (got ${defW})`)
  ok(docW === 3000, `document preset caps at 3000px (got ${docW})`)
  ok(docW > defW, 'document preset dimension > default preset dimension')

  // 5. Never grows: an already-tiny image round-trips as passthrough, not larger.
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).webp().toBuffer()
  const r5 = await optimizeImage(tiny, 'image/webp')
  ok(r5.finalBytes <= r5.originalBytes, `never grows (tiny webp ${r5.originalBytes} -> ${r5.finalBytes})`)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
