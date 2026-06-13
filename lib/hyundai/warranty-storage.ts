import { supabaseAdmin } from '@/lib/supabase/admin'

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

export async function uploadWarrantyEvidence(actionId: string, file: File, index: number) {
  await ensureHyundaiWarrantyBucket()
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80)
  const path = `${actionId}/${Date.now()}-${index}-${safeName || `evidence.${extension}`}`
  const { error } = await supabaseAdmin.storage.from(HYUNDAI_WARRANTY_BUCKET).upload(
    path,
    Buffer.from(await file.arrayBuffer()),
    { contentType: file.type, upsert: false }
  )
  if (error) throw error
  return path
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
