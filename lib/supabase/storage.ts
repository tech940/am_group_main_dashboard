import { createClient } from '@/lib/supabase/server'

const BUCKET_NAME = 'purchase-orders'

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

    // Generate unique filename
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const extension = typeof file === 'string' ? 'pdf' : file.name.split('.').pop()
    const filename = `${orderId}_${timestamp}_${randomStr}.${extension}`
    const filePath = `${folder}/${filename}`

    let fileData: Buffer | Blob
    let contentType: string

    if (typeof file === 'string') {
      // Handle base64 string
      const base64Data = file.split(',')[1] || file
      fileData = Buffer.from(base64Data, 'base64')
      contentType = file.includes('data:') ? file.split(';')[0].split(':')[1] : 'application/pdf'
    } else {
      // Handle File object
      fileData = file
      contentType = file.type
    }

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, fileData, {
        contentType,
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
  } catch (error: any) {
    console.error('Error in uploadFile:', error)
    return { url: '', path: '', error: error.message }
  }
}

/**
 * Delete a file from Supabase Storage
 * @param filePath - Path to the file in the bucket
 * @returns Success status
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const supabase = await createClient()

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
    const supabase = await createClient()

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