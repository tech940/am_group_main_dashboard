import { db } from '@/lib/db'
import { showroomImages } from '@/lib/db/schema'
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm'
import {
  type ShowroomBrandKey,
  getShowroomBucketForBrand,
  isValidShowroomBrand,
  getLocationsForBrand,
} from './constants'

export type ShowroomImageRecord = {
  id: string
  sessionId: string
  brand: string
  location: string
  bucketId: string
  storagePath: string
  fileSize: number | null
  width: number | null
  height: number | null
  mimeType: string | null
  uploaderName: string | null
  capturedAt: string
  createdAt: string
  url: string
}

export type ShowroomUploadSession = {
  sessionId: string
  brand: string
  location: string
  capturedAt: string
  uploaderName: string | null
  totalImages: number
  images: ShowroomImageRecord[]
}

function getStorageUrl(bucketId: string, storagePath: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return `${supabaseUrl}/storage/v1/object/public/${bucketId}/${storagePath}`
}

export async function uploadShowroomImages({
  brand,
  location,
  uploaderName,
  files,
}: {
  brand: ShowroomBrandKey
  location: string
  uploaderName?: string | null
  files: Array<{ buffer: Buffer; mimeType?: string; size?: number }>
}) {
  if (!isValidShowroomBrand(brand)) {
    throw new Error(`Invalid brand: ${brand}`)
  }

  const validLocations = getLocationsForBrand(brand)
  if (!validLocations.includes(location)) {
    throw new Error(`Invalid location '${location}' for brand '${brand}'. Expected one of: ${validLocations.join(', ')}`)
  }

  if (!files || files.length === 0) {
    throw new Error('At least one photo is required.')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase storage credentials not configured.')
  }

  const bucketId = getShowroomBucketForBrand(brand)
  const sessionId = crypto.randomUUID()
  const now = new Date()
  const sanitizedLocation = location.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()

  const insertedRows: ShowroomImageRecord[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.mimeType?.includes('jpeg') || file.mimeType?.includes('jpg') ? 'jpg' : 'webp'
    const fileName = `${Date.now()}_${i + 1}.${ext}`
    const storagePath = `${sanitizedLocation}/${sessionId}/${fileName}`

    // Upload to brand bucket
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${bucketId}/${storagePath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': file.mimeType || 'image/webp',
        'x-upsert': 'true',
      },
      body: new Uint8Array(file.buffer),
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '')
      throw new Error(`Storage upload failed for image ${i + 1}: ${uploadRes.status} ${errText}`)
    }

    // Insert database record
    const [inserted] = await db
      .insert(showroomImages)
      .values({
        sessionId,
        brand,
        location,
        bucketId,
        storagePath,
        fileSize: file.size || file.buffer.length,
        mimeType: file.mimeType || 'image/webp',
        uploaderName: uploaderName?.trim() || null,
        capturedAt: now,
      })
      .returning()

    insertedRows.push({
      id: inserted.id,
      sessionId: inserted.sessionId,
      brand: inserted.brand,
      location: inserted.location,
      bucketId: inserted.bucketId,
      storagePath: inserted.storagePath,
      fileSize: inserted.fileSize,
      width: inserted.width,
      height: inserted.height,
      mimeType: inserted.mimeType,
      uploaderName: inserted.uploaderName,
      capturedAt: inserted.capturedAt.toISOString(),
      createdAt: inserted.createdAt.toISOString(),
      url: getStorageUrl(inserted.bucketId, inserted.storagePath),
    })
  }

  return {
    sessionId,
    brand,
    location,
    uploaderName: uploaderName || null,
    totalImages: insertedRows.length,
    images: insertedRows,
  }
}

export async function getShowroomGallerySessions({
  brand,
  location,
  startDate,
  endDate,
  limit = 50,
}: {
  brand?: string | null
  location?: string | null
  startDate?: string | null
  endDate?: string | null
  limit?: number
}): Promise<{ sessions: ShowroomUploadSession[]; totalImages: number }> {
  const conditions = []

  if (brand && brand !== 'all') {
    conditions.push(eq(showroomImages.brand, brand.trim().toLowerCase()))
  }

  if (location && location !== 'all') {
    conditions.push(eq(showroomImages.location, location.trim()))
  }

  if (startDate) {
    const start = new Date(startDate)
    if (!Number.isNaN(start.getTime())) {
      conditions.push(gte(showroomImages.capturedAt, start))
    }
  }

  if (endDate) {
    const end = new Date(endDate)
    if (!Number.isNaN(end.getTime())) {
      // Set to end of day if only date is passed
      end.setHours(23, 59, 59, 999)
      conditions.push(lte(showroomImages.capturedAt, end))
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(showroomImages)
    .where(whereClause)
    .orderBy(desc(showroomImages.capturedAt))
    .limit(Math.min(limit * 20, 500))

  // Group by session_id
  const sessionMap = new Map<string, ShowroomUploadSession>()

  for (const row of rows) {
    const imgRecord: ShowroomImageRecord = {
      id: row.id,
      sessionId: row.sessionId,
      brand: row.brand,
      location: row.location,
      bucketId: row.bucketId,
      storagePath: row.storagePath,
      fileSize: row.fileSize,
      width: row.width,
      height: row.height,
      mimeType: row.mimeType,
      uploaderName: row.uploaderName,
      capturedAt: row.capturedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      url: getStorageUrl(row.bucketId, row.storagePath),
    }

    let session = sessionMap.get(row.sessionId)
    if (!session) {
      session = {
        sessionId: row.sessionId,
        brand: row.brand,
        location: row.location,
        capturedAt: row.capturedAt.toISOString(),
        uploaderName: row.uploaderName,
        totalImages: 0,
        images: [],
      }
      sessionMap.set(row.sessionId, session)
    }

    session.images.push(imgRecord)
    session.totalImages = session.images.length
  }

  const sessions = Array.from(sessionMap.values()).slice(0, limit)

  return {
    sessions,
    totalImages: rows.length,
  }
}
