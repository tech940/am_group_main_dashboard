import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { optimizeImage } from '@/lib/images/optimize'

const BUCKET_NAME = 'purchase-orders'

function getStorageAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is missing; purchase order file previews require the service role key.')
    return null
  }

  return supabaseAdmin
}

export interface UploadResult {
  url: string
  path: string
  error?: string
}

/**
 * Upload a file to Supabase Storage
 * @param file - File to upload (as base64 string or File object)
 * @param folder - Folder path in the bucket (e.g., 'quotations', 'invoices')
 * @param orderId - Purchase order ID for organizing files
 * @returns Upload result with URL and path
 */
export async function uploadFile(
  file: string | File,
  folder: string,
  orderId: string
): Promise<UploadResult> {
  try {
    const supabase = await createClient()

    // Resolve the raw bytes + source content-type up front so we can optimise before uploading.
    let sourceBuffer: Buffer
    let sourceType: string
    let originalExtension: string
    if (typeof file === 'string') {
      // Handle base64 string (used for generated PDFs — passes straight through the optimiser).
      const base64Data = file.split(',')[1] || file
      sourceBuffer = Buffer.from(base64Data, 'base64')
      sourceType = file.includes('data:') ? file.split(';')[0].split(':')[1] : 'application/pdf'
      originalExtension = 'pdf'
    } else {
      // Handle File object
      sourceBuffer = Buffer.from(await file.arrayBuffer())
      sourceType = file.type || 'application/octet-stream'
      originalExtension = file.name.split('.').pop() || 'bin'
    }

    // Re-encode raster images to WebP; non-raster (PDF/etc.) returns unchanged.
    const optimized = await optimizeImage(sourceBuffer, sourceType)

    // Generate unique filename. Only rename to .webp when we actually re-encoded — otherwise keep the
    // file's original extension so passthrough uploads (PDFs, anything non-raster) are untouched.
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const extension = optimized.optimized ? 'webp' : originalExtension
    const filename = `${orderId}_${timestamp}_${randomStr}.${extension}`
    const filePath = `${folder}/${filename}`

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, optimized.buffer, {
        contentType: optimized.contentType,
        upsert: false,
      })

    if (error) {
      console.error('Error uploading file:', error)
      return { url: '', path: '', error: error.message }
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath)

    return {
      url: urlData.publicUrl,
      path: filePath,
    }
  } catch (error) {
    console.error('Error in uploadFile:', error)
    return {
      url: '',
      path: '',
      error: error instanceof Error ? error.message : 'Unknown upload error',
    }
  }
}

/**
 * Delete a file from Supabase Storage
 * @param filePath - Path to the file in the bucket
 * @returns Success status
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const supabase = getStorageAdminClient() || await createClient()

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath])

    if (error) {
      console.error('Error deleting file:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error in deleteFile:', error)
    return false
  }
}

/**
 * Get a signed URL for a private file
 * @param filePath - Path to the file in the bucket
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns Signed URL
 */
export async function getSignedUrl(
  filePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  try {
    const supabase = getStorageAdminClient()
    if (!supabase) {
      return null
    }

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, expiresIn)

    if (error) {
      console.error('Error creating signed URL:', error)
      return null
    }

    return data.signedUrl
  } catch (error) {
    console.error('Error in getSignedUrl:', error)
    return null
  }
}

// Made with Bob
