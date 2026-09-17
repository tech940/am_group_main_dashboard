import 'server-only'

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { optimizeImage } from '@/lib/images/optimize'
import { FILE_KIND_POLICY, HP_MAX_FILE_BYTES, type FileKind } from './constants'
import { extensionForSniffedType, isImageType, sniffFileType, type SniffedType } from './file-sniff'

/**
 * Storage for H Promise files — buyers' and sellers' PAN and Aadhaar, cheques, RCs, ledgers.
 *
 * ⚠️ A PRIVATE bucket, read back only through short signed URLs (the gate-pass pattern). The sheet this
 * replaces kept every one of these as an "anyone with the link" Google Drive file; lib/supabase/storage.ts
 * would do the same thing with a public bucket. Neither is acceptable for identity documents.
 *
 * ⚠️ The file's CONTENT decides what it is (file-sniff.ts), not the header the browser sent. The object key
 * is built entirely on the server — nothing the caller typed reaches it.
 */

export const HP_BUCKET = 'tata-h-promise'
const ALLOWED_TYPES: SniffedType[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

/** Long enough to render a page or open one document, not to pass around. */
const SIGNED_URL_TTL_SECONDS = 300

let bucketEnsured: Promise<void> | null = null

export async function ensureHPromiseBucket(): Promise<void> {
  if (!bucketEnsured) {
    bucketEnsured = (async () => {
      const { data } = await supabaseAdmin.storage.getBucket(HP_BUCKET)
      if (data) return
      const { error } = await supabaseAdmin.storage.createBucket(HP_BUCKET, {
        public: false,
        fileSizeLimit: HP_MAX_FILE_BYTES,
        allowedMimeTypes: ALLOWED_TYPES,
      })
      if (error && !error.message.toLowerCase().includes('already exists')) throw error
    })().catch((error) => {
      bucketEnsured = null
      throw error
    })
  }
  return bucketEnsured
}

export class HPromiseUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HPromiseUploadError'
  }
}

export type StoredFile = {
  path: string
  contentType: SniffedType
  sizeBytes: number
  sha256: string
}

const SAFE_SEGMENT = /^[a-z0-9-]{1,64}$/i

/**
 * Validate and store one file.
 *
 * `folder` is a vehicle id or `staging-<userId>` and `fileId` is the row id the caller will insert — both are
 * UUID-shaped values the server generated, and both are checked again here.
 */
export async function storeHPromiseFile(input: {
  bytes: Buffer
  kind: FileKind
  folder: string
  fileId: string
  /** Only the one-time sheet import: a historical screenshot that was saved as a PDF is kept as it is. */
  allowPdf?: boolean
}): Promise<StoredFile> {
  const { bytes, kind, folder, fileId } = input
  if (bytes.byteLength === 0) throw new HPromiseUploadError('That file is empty.', 400)
  if (bytes.byteLength > HP_MAX_FILE_BYTES) throw new HPromiseUploadError('That file is larger than 10 MB.', 413)
  if (!SAFE_SEGMENT.test(folder) || !SAFE_SEGMENT.test(fileId)) {
    throw new HPromiseUploadError('That upload could not be filed.', 400)
  }

  const sniffed = sniffFileType(bytes)
  const policy = FILE_KIND_POLICY[kind]
  if (!sniffed) {
    throw new HPromiseUploadError(
      policy.acceptsPdf ? 'Only JPEG, PNG, WebP or PDF files are accepted.' : 'Only JPEG, PNG or WebP photos are accepted.',
      415,
    )
  }
  if (sniffed === 'application/pdf' && !policy.acceptsPdf && !input.allowPdf) {
    throw new HPromiseUploadError(`${policy.label} must be a photo, not a PDF.`, 415)
  }

  await ensureHPromiseBucket()

  let buffer = bytes
  let contentType: SniffedType = sniffed
  if (isImageType(sniffed)) {
    // optimizeImage never throws; on failure it hands back the original bytes, which we then keep.
    const optimized = await optimizeImage(bytes, sniffed, { preset: policy.preset })
    const resniffed = sniffFileType(optimized.buffer)
    if (resniffed && isImageType(resniffed) && optimized.buffer.byteLength > 0) {
      buffer = optimized.buffer
      contentType = resniffed
    }
  }

  const path = `${folder}/${kind}/${fileId}.${extensionForSniffedType(contentType)}`
  const { error } = await supabaseAdmin.storage
    .from(HP_BUCKET)
    .upload(path, buffer, { contentType, upsert: false })
  if (error) {
    console.error('[h-promise] storage upload failed:', error)
    throw new HPromiseUploadError('The file could not be stored. Please try again.', 502)
  }

  return {
    path,
    contentType,
    sizeBytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

/** One signed URL, or null — a dead path must not blank a page. */
export async function signHPromisePath(path: string, downloadName?: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(HP_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, downloadName ? { download: downloadName } : undefined)
  if (error || !data) return null
  return data.signedUrl
}

/*
 * Preview URLs are re-used for three of their five minutes, per server instance: reopening a vehicle then
 * costs no storage round trip. Only preview (non-personal) paths pass through here.
 */
const PREVIEW_REUSE_MS = 3 * 60_000
const previewCache = new Map<string, { url: string; at: number }>()

/** Many paths in one storage call. Returns path → signed URL for the ones that exist. */
export async function signHPromisePaths(paths: ReadonlyArray<string>): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => typeof path === 'string' && path.length > 0)))
  if (unique.length === 0) return {}
  const now = Date.now()
  const map: Record<string, string> = {}
  const missing: string[] = []
  for (const path of unique) {
    const hit = previewCache.get(path)
    if (hit && now - hit.at < PREVIEW_REUSE_MS) map[path] = hit.url
    else missing.push(path)
  }
  if (missing.length === 0) return map
  try {
    const { data, error } = await supabaseAdmin.storage.from(HP_BUCKET).createSignedUrls(missing, SIGNED_URL_TTL_SECONDS)
    if (error || !data) return map
    for (const item of data) {
      if (item.signedUrl && item.path) {
        map[item.path] = item.signedUrl
        previewCache.set(item.path, { url: item.signedUrl, at: now })
      }
    }
    if (previewCache.size > 2000) {
      for (const [path, hit] of previewCache) if (now - hit.at >= PREVIEW_REUSE_MS) previewCache.delete(path)
    }
    return map
  } catch {
    return map
  }
}

/** Remove objects whose rows were never attached (orphan sweep) or whose write rolled back. */
export async function removeHPromiseObjects(paths: ReadonlyArray<string>): Promise<void> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (unique.length === 0) return
  const { error } = await supabaseAdmin.storage.from(HP_BUCKET).remove(unique)
  if (error) console.error('[h-promise] could not remove objects:', error)
}
