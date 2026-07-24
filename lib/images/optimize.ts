import sharp from 'sharp'

// Shared server-side image optimizer. Every upload choke-point routes its bytes through
// optimizeImage() before they hit Supabase Storage, so uploaded photos/scans are re-encoded to WebP
// (typically ~25-35% smaller than the JPEG the browser sends) with a consistent size cap, regardless
// of which surface produced them.
//
// This generalises the proven downscale in app/api/brands/kia/bookings/extract-id-document/route.ts
// (toGroqImage), retargeted from JPEG to WebP.
//
// TWO GUARANTEES the callers depend on — do not weaken either:
//   1. It NEVER throws. On any sharp failure (e.g. a HEIC input on a runtime without libheif, or a
//      corrupt file) it returns the ORIGINAL buffer untouched. An upload must never fail because
//      optimisation failed — worst case we store what we store today.
//   2. It NEVER grows the object. If the WebP comes out >= the original, the original is returned.
// Both cases report `optimized: false` so callers/backfill can tell a real re-encode from a passthrough.
//
// It also only touches RASTER photos. PDFs, SVGs, GIFs and anything animated/multi-page pass straight
// through — so it is safe to drop into routes that also accept PDFs (petty cash, purchase orders).

/** Raster types we re-encode. Everything else passes through untouched. */
const RASTER_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/tiff',
  'image/avif',
])

const RASTER_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tiff',
  'tif',
  'avif',
])

export type ImagePreset = 'default' | 'document'

/**
 * `document` is for KYC / cost-sheet scans (PAN, Aadhaar, invoices) where text legibility is a legal
 * concern — larger max dimension and higher quality, still far smaller than a raw phone photo.
 */
const PRESETS: Record<ImagePreset, { maxDimension: number; quality: number }> = {
  default: { maxDimension: 2000, quality: 80 },
  document: { maxDimension: 3000, quality: 90 },
}

export interface OptimizeOptions {
  preset?: ImagePreset
  /** Overrides the preset's max dimension (longest edge, px). */
  maxDimension?: number
  /** Overrides the preset's WebP quality (1-100). */
  quality?: number
  /** Optional filename to infer MIME type if mimeType parameter is generic or missing. */
  filename?: string
}

export interface OptimizeResult {
  /** The bytes to store — WebP when `optimized` or contentType is image/webp, otherwise original. */
  buffer: Buffer
  /** Content-Type to send to storage — `image/webp` for raster images, else the original mime. */
  contentType: string
  /** File extension to name the stored object with — `webp` for raster images, else derived from mime. */
  extension: string
  /** true when successfully converted to WebP. */
  optimized: boolean
  originalBytes: number
  finalBytes: number
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
}

function extensionForType(contentType: string): string {
  return EXT_BY_TYPE[contentType] ?? 'bin'
}

function normaliseMime(mimeType: string): string {
  // Strip any "; charset=" etc. and lower-case, so "IMAGE/JPEG; x" matches.
  return (mimeType || '').toLowerCase().split(';')[0].trim()
}

/**
 * Re-encode any raster image to WebP format before storing in database/storage.
 * Non-raster files (e.g. PDFs) pass through untouched.
 * @param input    the raw file bytes
 * @param mimeType the source content type (e.g. from `File.type`)
 * @param opts     optional preset, dimensions, quality, or filename
 */
export async function optimizeImage(
  input: Buffer,
  mimeType: string,
  opts: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const originalBytes = input.byteLength
  let contentType = normaliseMime(mimeType) || 'application/octet-stream'

  // If MIME is generic, check filename extension
  if ((contentType === 'application/octet-stream' || !contentType) && opts.filename) {
    const ext = opts.filename.split('.').pop()?.toLowerCase() || ''
    if (RASTER_EXTENSIONS.has(ext)) {
      contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
    }
  }

  const passthrough = (): OptimizeResult => ({
    buffer: input,
    contentType,
    extension: extensionForType(contentType),
    optimized: false,
    originalBytes,
    finalBytes: originalBytes,
  })

  let isRaster = RASTER_TYPES.has(contentType)

  // Probe sharp metadata if MIME check didn't confirm raster type
  if (!isRaster) {
    try {
      const probeMeta = await sharp(input, { failOn: 'none' }).metadata()
      if (probeMeta.format && ['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff', 'magick'].includes(probeMeta.format)) {
        isRaster = true
      }
    } catch {
      // Not a valid image format readable by sharp
    }
  }

  // Non-raster (pdf/svg/unknown binary) — pass through untouched
  if (!isRaster) return passthrough()

  const preset = PRESETS[opts.preset ?? 'default']
  const maxDimension = opts.maxDimension ?? preset.maxDimension
  const quality = opts.quality ?? preset.quality

  try {
    const meta = await sharp(input, { failOn: 'none' }).metadata()
    // Don't flatten multi-frame images (animated WebP/GIF-in-webp): drop to passthrough
    if ((meta.pages ?? 1) > 1) return passthrough()

    const out = await sharp(input, { failOn: 'none' })
      .rotate() // bake in EXIF orientation from phone photos; metadata (incl. GPS) dropped by default
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer()

    return {
      buffer: out,
      contentType: 'image/webp',
      extension: 'webp',
      optimized: true,
      originalBytes,
      finalBytes: out.byteLength,
    }
  } catch (error) {
    console.error('[optimizeImage] sharp failed; storing original unchanged:', error)
    return passthrough()
  }
}
