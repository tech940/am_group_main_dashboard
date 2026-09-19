import { db } from '@/lib/db'
import { showroomImages } from '@/lib/db/schema'
import { desc, eq, and, gte, lte } from 'drizzle-orm'
import {
  type ShowroomBrandKey,
  type ShowroomDepartmentKey,
  type ShowroomCategoryKey,
  getShowroomBucketForBrand,
  isValidShowroomBrand,
  getLocationsForBrand,
} from './constants'

export type ShowroomImageRecord = {
  id: string
  sessionId: string
  brand: string
  location: string
  department: string
  category: string
  categorySlot: number | null
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
  department: string
  capturedAt: string
  uploaderName: string | null
  totalImages: number
  images: ShowroomImageRecord[]
  byCategory: {
    vehicles: ShowroomImageRecord[]
    tv: ShowroomImageRecord[]
    standee: ShowroomImageRecord[]
    lounge: ShowroomImageRecord[]
    bathroom: ShowroomImageRecord[]
  }
}

function getStorageUrl(bucketId: string, storagePath: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return `${supabaseUrl}/storage/v1/object/public/${bucketId}/${storagePath}`
}

export async function uploadShowroomImages({
  brand,
  location,
  department = 'sales',
  uploaderName,
  files,
}: {
  brand: ShowroomBrandKey
  location: string
  department?: ShowroomDepartmentKey | string
  uploaderName?: string | null
  files: Array<{
    buffer: Buffer
    category?: string
    categorySlot?: number
    mimeType?: string
    size?: number
  }>
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

  const validDept = department.toLowerCase() === 'service' ? 'service' : 'sales'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase storage credentials not configured.')
  }

  const bucketId = getShowroomBucketForBrand(brand)
  const now = new Date()
  const sanitizedLocation = location.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()

  // Prevent splitting: If there was an upload for the exact same brand/location/department in the last 20 mins, reuse that sessionId
  let sessionId = crypto.randomUUID()
  try {
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000)
    const recentRecords = await db
      .select({ sessionId: showroomImages.sessionId })
      .from(showroomImages)
      .where(
        and(
          eq(showroomImages.brand, brand.trim().toLowerCase()),
          eq(showroomImages.location, location.trim()),
          eq(showroomImages.department, validDept),
          gte(showroomImages.capturedAt, twentyMinsAgo)
        )
      )
      .limit(1)

    if (recentRecords.length > 0 && recentRecords[0].sessionId) {
      sessionId = recentRecords[0].sessionId
    }
  } catch (err) {
    console.warn('[uploadShowroomImages] Failed to check recent session, using fresh UUID:', err)
  }

  // Prepare metadata and storage paths for all files
  const preparedUploads = files.map((file, i) => {
    const cat = file.category || 'vehicles'
    const slot = file.categorySlot || (i % 2) + 1
    const ext = file.mimeType?.includes('jpeg') || file.mimeType?.includes('jpg') ? 'jpg' : 'webp'
    const fileName = `${Date.now()}_${cat}_${slot}_${i + 1}_${crypto.randomUUID().slice(0, 8)}.${ext}`
    const storagePath = `${sanitizedLocation}/${validDept}/${sessionId}/${fileName}`

    return {
      file,
      cat,
      slot,
      mimeType: file.mimeType || (ext === 'jpg' ? 'image/jpeg' : 'image/webp'),
      storagePath,
    }
  })

  // Concurrently upload all photos to Supabase Storage
  await Promise.all(
    preparedUploads.map(async (item, i) => {
      const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${bucketId}/${item.storagePath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': item.mimeType,
          'x-upsert': 'true',
        },
        body: new Uint8Array(item.file.buffer),
      })

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '')
        throw new Error(`Storage upload failed for image ${i + 1}: ${uploadRes.status} ${errText}`)
      }
    })
  )

  // Single batch insert into database
  const insertValues = preparedUploads.map((item) => ({
    sessionId,
    brand,
    location,
    department: validDept,
    category: item.cat,
    categorySlot: item.slot,
    bucketId,
    storagePath: item.storagePath,
    fileSize: item.file.size || item.file.buffer.length,
    mimeType: item.mimeType,
    uploaderName: uploaderName?.trim() || null,
    capturedAt: now,
  }))

  const insertedRecords = await db
    .insert(showroomImages)
    .values(insertValues)
    .returning()

  const insertedRows: ShowroomImageRecord[] = insertedRecords.map((inserted) => ({
    id: inserted.id,
    sessionId: inserted.sessionId,
    brand: inserted.brand,
    location: inserted.location,
    department: inserted.department,
    category: inserted.category,
    categorySlot: inserted.categorySlot,
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
  }))

  const byCat = {
    vehicles: insertedRows.filter((r) => r.category === 'vehicles'),
    tv: insertedRows.filter((r) => r.category === 'tv'),
    standee: insertedRows.filter((r) => r.category === 'standee'),
    lounge: insertedRows.filter((r) => r.category === 'lounge'),
    bathroom: insertedRows.filter((r) => r.category === 'bathroom'),
  }

  return {
    sessionId,
    brand,
    location,
    department: validDept,
    uploaderName: uploaderName || null,
    totalImages: insertedRows.length,
    images: insertedRows,
    byCategory: byCat,
  }
}

export async function getShowroomGallerySessions({
  brand,
  location,
  department,
  category,
  startDate,
  endDate,
  limit = 50,
}: {
  brand?: string | null
  location?: string | null
  department?: string | null
  category?: string | null
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

  if (department && department !== 'all') {
    conditions.push(eq(showroomImages.department, department.trim().toLowerCase()))
  }

  if (category && category !== 'all') {
    conditions.push(eq(showroomImages.category, category.trim().toLowerCase()))
  }

  if (startDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())
    const start = isIsoDateOnly
      ? new Date(`${startDate.trim()}T00:00:00.000+05:30`)
      : new Date(startDate)
    if (!Number.isNaN(start.getTime())) {
      conditions.push(gte(showroomImages.capturedAt, start))
    }
  }

  if (endDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())
    const end = isIsoDateOnly
      ? new Date(`${endDate.trim()}T23:59:59.999+05:30`)
      : new Date(endDate)
    if (!Number.isNaN(end.getTime())) {
      conditions.push(lte(showroomImages.capturedAt, end))
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(showroomImages)
    .where(whereClause)
    .orderBy(desc(showroomImages.capturedAt))
    .limit(Math.min(limit * 30, 600))

  // Intelligent session grouping: Coalesce uploads from the same branch/dept within 25 minutes
  const sessionsList: ShowroomUploadSession[] = []

  for (const row of rows) {
    const rowTime = new Date(row.capturedAt).getTime()
    const imgRecord: ShowroomImageRecord = {
      id: row.id,
      sessionId: row.sessionId,
      brand: row.brand,
      location: row.location,
      department: row.department,
      category: row.category,
      categorySlot: row.categorySlot,
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

    // Check if there is an existing session card for the same brand, location, and department within 25 mins
    const existingSession = sessionsList.find((s) => {
      if (
        s.brand.toLowerCase() !== row.brand.toLowerCase() ||
        s.location.toLowerCase() !== row.location.toLowerCase() ||
        s.department.toLowerCase() !== row.department.toLowerCase()
      ) {
        return false
      }
      const sTime = new Date(s.capturedAt).getTime()
      return Math.abs(sTime - rowTime) <= 25 * 60 * 1000
    })

    if (existingSession) {
      existingSession.images.push(imgRecord)
      existingSession.totalImages = existingSession.images.length
      if (imgRecord.uploaderName && !existingSession.uploaderName) {
        existingSession.uploaderName = imgRecord.uploaderName
      }
      if (row.category === 'vehicles') {
        existingSession.byCategory.vehicles.push(imgRecord)
      } else if (row.category === 'tv') {
        existingSession.byCategory.tv.push(imgRecord)
      } else if (row.category === 'standee') {
        existingSession.byCategory.standee.push(imgRecord)
      } else if (row.category === 'lounge') {
        existingSession.byCategory.lounge.push(imgRecord)
      } else if (row.category === 'bathroom') {
        existingSession.byCategory.bathroom.push(imgRecord)
      }
    } else {
      const newSession: ShowroomUploadSession = {
        sessionId: row.sessionId,
        brand: row.brand,
        location: row.location,
        department: row.department,
        capturedAt: row.capturedAt.toISOString(),
        uploaderName: row.uploaderName,
        totalImages: 1,
        images: [imgRecord],
        byCategory: {
          vehicles: row.category === 'vehicles' ? [imgRecord] : [],
          tv: row.category === 'tv' ? [imgRecord] : [],
          standee: row.category === 'standee' ? [imgRecord] : [],
          lounge: row.category === 'lounge' ? [imgRecord] : [],
          bathroom: row.category === 'bathroom' ? [imgRecord] : [],
        },
      }
      sessionsList.push(newSession)
    }
  }

  const sessions = sessionsList.slice(0, limit)

  return {
    sessions,
    totalImages: rows.length,
  }
}

export async function deleteShowroomSession(sessionId: string) {
  if (!sessionId) {
    throw new Error('sessionId is required to delete session')
  }

  // 1. Fetch the records for this session
  const records = await db
    .select()
    .from(showroomImages)
    .where(eq(showroomImages.sessionId, sessionId))

  if (!records.length) {
    return { success: true, count: 0 }
  }

  // 2. Delete storage files
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl && serviceKey) {
    for (const record of records) {
      try {
        await fetch(`${supabaseUrl}/storage/v1/object/${record.bucketId}/${record.storagePath}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
        })
      } catch (err) {
        console.warn(`Failed to delete storage file ${record.storagePath}:`, err)
      }
    }
  }

  // 3. Delete database records
  await db.delete(showroomImages).where(eq(showroomImages.sessionId, sessionId))

  return { success: true, count: records.length }
}
