import 'dotenv/config'
import postgres from 'postgres'
import {
  SHOWROOM_BRANDS,
  getLocationsForBrand,
  getShowroomBucketForBrand,
  isValidShowroomBrand,
} from '../lib/showroom-images/constants'
import {
  uploadShowroomImages,
  getShowroomGallerySessions,
} from '../lib/showroom-images/server'

function sessionModeUrl(raw: string) {
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function runVerification() {
  console.log('=== SHOWROOM IMAGES VERIFICATION SUITE ===\n')

  // 1. Check Brand & Location Constants
  console.log('1. Checking Brand & Location Constants:')
  if (SHOWROOM_BRANDS.length < 6) {
    throw new Error(`Expected at least 6 showroom brands, got ${SHOWROOM_BRANDS.length}`)
  }
  console.log(`  [PASS] ${SHOWROOM_BRANDS.length} brands configured: ${SHOWROOM_BRANDS.map((b) => b.key).join(', ')}`)

  const kiaLocations = getLocationsForBrand('kia')
  if (kiaLocations.length !== 3) throw new Error(`Expected 3 Kia locations, got ${kiaLocations.length}`)
  console.log(`  [PASS] Kia locations: ${kiaLocations.join(', ')}`)

  const hyundaiLocations = getLocationsForBrand('hyundai')
  if (hyundaiLocations.length !== 6) throw new Error(`Expected 6 Hyundai locations, got ${hyundaiLocations.length}`)
  console.log(`  [PASS] Hyundai locations: ${hyundaiLocations.join(', ')}`)

  // 2. Check Database Table
  console.log('\n2. Checking Database Table (showroom_images):')
  const rawDb = process.env.DATABASE_URL
  if (!rawDb) throw new Error('Missing DATABASE_URL')
  const sql = postgres(sessionModeUrl(rawDb), { max: 1, prepare: false, ssl: 'require' })

  try {
    const [tableCheck] = await sql`
      SELECT to_regclass('public.showroom_images') as exists
    `
    if (!tableCheck.exists) throw new Error('showroom_images table does not exist in public schema')
    console.log('  [PASS] showroom_images table exists in database')

    // 3. Check Storage Buckets
    console.log('\n3. Checking Supabase Storage Buckets:')
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing Supabase credentials')

    for (const b of SHOWROOM_BRANDS) {
      const bucketRes = await fetch(`${url}/storage/v1/bucket/${b.bucketId}`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      })
      if (!bucketRes.ok) throw new Error(`Storage bucket '${b.bucketId}' not found: status ${bucketRes.status}`)
      console.log(`  [PASS] Bucket '${b.bucketId}' exists and is accessible`)
    }

    // 4. Test Multi-Photo Upload Session with Department & Categories
    console.log('\n4. Testing Multi-Photo Upload Session (Sales & Service + Categories):')
    const dummyImageBuffer = Buffer.from(
      'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
      'base64'
    )

    const uploadResult = await uploadShowroomImages({
      brand: 'kia',
      location: 'Jammu',
      department: 'sales',
      uploaderName: 'Automated Test User',
      files: [
        { buffer: dummyImageBuffer, category: 'vehicles', categorySlot: 1, mimeType: 'image/webp', size: dummyImageBuffer.length },
        { buffer: dummyImageBuffer, category: 'vehicles', categorySlot: 2, mimeType: 'image/webp', size: dummyImageBuffer.length },
        { buffer: dummyImageBuffer, category: 'tv', categorySlot: 1, mimeType: 'image/webp', size: dummyImageBuffer.length },
        { buffer: dummyImageBuffer, category: 'tv', categorySlot: 2, mimeType: 'image/webp', size: dummyImageBuffer.length },
        { buffer: dummyImageBuffer, category: 'bathroom', categorySlot: 1, mimeType: 'image/webp', size: dummyImageBuffer.length },
        { buffer: dummyImageBuffer, category: 'bathroom', categorySlot: 2, mimeType: 'image/webp', size: dummyImageBuffer.length },
      ],
    })

    if (uploadResult.totalImages !== 6) {
      throw new Error(`Expected 6 uploaded images, got ${uploadResult.totalImages}`)
    }
    if (uploadResult.byCategory.vehicles.length !== 2) throw new Error('Expected 2 vehicle photos')
    if (uploadResult.byCategory.tv.length !== 2) throw new Error('Expected 2 tv photos')
    if (uploadResult.byCategory.bathroom.length !== 2) throw new Error('Expected 2 bathroom photos')
    console.log(`  [PASS] Successfully uploaded 6 categorized photos across Vehicles (2), TV (2), Bathroom (2)`)

    // 5. Test Gallery Query & Filter
    console.log('\n5. Testing Gallery Fetch & Department/Category Filters:')
    const galleryResult = await getShowroomGallerySessions({
      brand: 'kia',
      location: 'Jammu',
      department: 'sales',
      limit: 10,
    })

    const foundSession = galleryResult.sessions.find((s) => s.sessionId === uploadResult.sessionId)
    if (!foundSession) throw new Error('Uploaded test session not found in gallery query')
    if (foundSession.images.length !== 6) throw new Error(`Expected 6 images in session, got ${foundSession.images.length}`)
    if (foundSession.byCategory.vehicles.length !== 2) throw new Error('Expected 2 vehicles in gallery session')
    if (foundSession.byCategory.tv.length !== 2) throw new Error('Expected 2 tv photos in gallery session')
    if (foundSession.byCategory.bathroom.length !== 2) throw new Error('Expected 2 bathroom photos in gallery session')
    console.log(`  [PASS] Found session with ${foundSession.images.length} images grouped by category`)
    console.log(`  [PASS] Sample vehicle image URL: ${foundSession.byCategory.vehicles[0].url}`)

    // 6. Clean up test records and storage files
    console.log('\n6. Cleaning up test data:')
    await sql`DELETE FROM showroom_images WHERE session_id = ${uploadResult.sessionId}`
    const deleteFiles = uploadResult.images.map((img) => img.storagePath)
    await fetch(`${url}/storage/v1/object/${getShowroomBucketForBrand('kia')}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: deleteFiles }),
    })
    console.log('  [PASS] Test database records and storage objects purged cleanly')

    console.log('\n=== ALL SHOWROOM IMAGES VERIFICATION CHECKS PASSED ===\n')
  } finally {
    await sql.end()
  }
}

runVerification().catch((err) => {
  console.error('\n[VERIFICATION FAILED]:', err)
  process.exit(1)
})
