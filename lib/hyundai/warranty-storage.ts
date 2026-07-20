import { supabaseAdmin } from '@/lib/supabase/admin'
import { optimizeImage } from '@/lib/images/optimize'

export const HYUNDAI_WARRANTY_BUCKET = 'hyundai-warranty-claims'
export const WARRANTY_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const WARRANTY_MAX_FILE_BYTES = 10 * 1024 * 1024
export const WARRANTY_MAX_FILES = 10

export async function ensureHyundaiWarrantyBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(HYUNDAI_WARRANTY_BUCKET)
  if (data) return
  const { error } = await supabaseAdmin.storage.createBucket(HYUNDAI_WARRANTY_BUCKET, {
    public: false,
    fileSizeLimit: WARRANTY_MAX_FILE_BYTES,
    allowedMimeTypes: [...WARRANTY_ALLOWED_IMAGE_TYPES],
  })
  if (error && !error.message.toLowerCase().includes('already exists')) throw error
}

export async function uploadWarrantyEvidence(
  actionId: string,
  file: File,
  index: number,
): Promise<{ path: string; contentType: string; size: number }> {
  await ensureHyundaiWarrantyBucket()
  // Re-encode raster evidence to WebP (webp is in this bucket's allowedMimeTypes).
  const optimized = await optimizeImage(Buffer.from(await file.arrayBuffer()), file.type)
  const extension = optimized.optimized
    ? 'webp'
    : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  // Strip any original extension off the display name so the stored object's extension matches its
  // actual content (webp bytes never land under a .jpg name).
  const safeBase = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/\.[a-zA-Z0-9]+$/, '').slice(-80)
  const path = `${actionId}/${Date.now()}-${index}-${safeBase || 'evidence'}.${extension}`
  const { error } = await supabaseAdmin.storage.from(HYUNDAI_WARRANTY_BUCKET).upload(
    path,
    optimized.buffer,
    { contentType: optimized.contentType, upsert: false }
  )
  if (error) throw error
  return { path, contentType: optimized.contentType, size: optimized.finalBytes }
}

export async function deleteWarrantyEvidence(paths: string[]) {
  if (paths.length === 0) return
  await supabaseAdmin.storage.from(HYUNDAI_WARRANTY_BUCKET).remove(paths)
}

export async function getWarrantyEvidenceUrl(path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(HYUNDAI_WARRANTY_BUCKET)
    .createSignedUrl(path, 900)
  if (error) throw error
  return data.signedUrl
}
