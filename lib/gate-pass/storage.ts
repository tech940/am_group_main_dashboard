import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { optimizeImage } from '@/lib/images/optimize'

/**
 * Storage for gate evidence — photos of vehicles, driving licences and signatures.
 *
 * ⚠️ A PRIVATE bucket, deliberately. lib/supabase/storage.ts `uploadFile()` targets the PUBLIC
 * `purchase-orders` bucket and returns getPublicUrl — anyone with the URL can read the object,
 * forever. That is wrong for a photograph of a person holding their driving licence. This follows
 * the warranty-claims pattern instead: private bucket, short-lived signed URLs on read.
 *
 * ⚠️ Size and MIME are checked BEFORE the bytes are read. app/api/brands/kia/vehicle-tracker has
 * neither and reads an unbounded File straight into memory — a guard's phone will happily POST
 * 12 MB, several times, from a car park with one bar of signal.
 */

export const GATE_PASS_BUCKET = 'demo-gate-pass'
export const GATE_PASS_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const GATE_PASS_MAX_FILE_BYTES = 10 * 1024 * 1024
export const GATE_PASS_MAX_FILES = 8

/** Signed URLs are short: five minutes is long enough to render a page, not to pass around. */
const SIGNED_URL_TTL_SECONDS = 300

export async function ensureGatePassBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(GATE_PASS_BUCKET)
  if (data) return
  const { error } = await supabaseAdmin.storage.createBucket(GATE_PASS_BUCKET, {
    public: false,
    fileSizeLimit: GATE_PASS_MAX_FILE_BYTES,
    allowedMimeTypes: [...GATE_PASS_ALLOWED_TYPES],
  })
  if (error && !error.message.toLowerCase().includes('already exists')) throw error
}

export class GatePassUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GatePassUploadError'
  }
}

/**
 * Store one piece of gate evidence and return its path.
 *
 * `kind` becomes part of the path (front / rear / odometer / signature / licence), so the object
 * store stays readable when somebody has to go looking without the database.
 */
export async function uploadGateEvidence(passNo: string, kind: string, file: File): Promise<string> {
  if (!(file instanceof File) || file.size === 0) {
    throw new GatePassUploadError('That file is empty.', 400)
  }
  if (file.size > GATE_PASS_MAX_FILE_BYTES) {
    throw new GatePassUploadError('That image is larger than 10 MB.', 413)
  }
  if (!GATE_PASS_ALLOWED_TYPES.has(file.type)) {
    throw new GatePassUploadError('Only JPEG, PNG and WebP images are accepted.', 415)
  }

  await ensureGatePassBucket()

  // optimizeImage never throws and never grows the object — a failure returns the original bytes,
  // which is the right trade at a gate: a heavier photo beats a lost one.
  const original = Buffer.from(await file.arrayBuffer())
  const optimized = await optimizeImage(original, file.type)
  const buffer = optimized.buffer ?? original
  const contentType = optimized.contentType ?? file.type
  const extension = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg'

  const safeKind = kind.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'evidence'
  // Slashes survive so a caller can pass a nested prefix (drivers/<userId>). Everything else is
  // stripped and '..' is removed, so a crafted pass number cannot climb out of its own folder.
  const safePrefix = String(passNo).replace(/\.\./g, '').replace(/[^a-zA-Z0-9_/-]+/g, '') || 'misc'
  const path = `${safePrefix}/${safeKind}-${Date.now()}.${extension}`

  const { error } = await supabaseAdmin.storage
    .from(GATE_PASS_BUCKET)
    .upload(path, buffer, { contentType, upsert: false })
  if (error) throw new GatePassUploadError(`Could not store the photo: ${error.message}`, 500)

  return path
}

/**
 * Store a photograph of a driving licence against a driver profile.
 *
 * ⚠️ Kept under `drivers/<userId>/` rather than under a pass number, because a licence belongs to a
 * person and outlives any single trip — filing it per-pass would mean re-uploading it every time.
 *
 * Same private bucket and the same short signed URLs as gate evidence. This is a government ID; it
 * must never reach the public bucket that lib/supabase/storage.ts writes to.
 */
export async function uploadDriverLicence(userId: string, file: File): Promise<string> {
  const safeUser = String(userId).replace(/[^a-zA-Z0-9_-]+/g, '')
  return uploadGateEvidence(`drivers/${safeUser}`, 'licence', file)
}

/** Read back one object. Returns null rather than throwing so one dead path cannot blank a page. */
export async function getGateEvidenceUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabaseAdmin.storage
    .from(GATE_PASS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

/** Sign a whole photo map at once, for the detail view. */
export async function signEvidenceMap(
  paths: Record<string, string> | null | undefined,
): Promise<Record<string, string>> {
  if (!paths) return {}
  const entries = Object.entries(paths)
  const signed: Record<string, string> = {}
  for (const [kind, path] of entries) {
    const url = await getGateEvidenceUrl(path)
    if (url) signed[kind] = url
  }
  return signed
}
