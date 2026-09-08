import 'dotenv/config'
import { db } from '../lib/db'
import { showroomImages } from '../lib/db/schema'
import { SHOWROOM_BRANDS } from '../lib/showroom-images/constants'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Supabase credentials not configured')
  process.exit(1)
}

const BUCKETS = SHOWROOM_BRANDS.map((b) => b.bucketId)

async function emptyBucket(bucketId: string) {
  console.log(`\nChecking bucket: ${bucketId}...`)

  async function listAllFiles(prefix = ''): Promise<string[]> {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucketId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' },
      }),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.log(`  Could not list files in ${bucketId} (prefix: '${prefix}'): ${res.status} ${txt}`)
      return []
    }

    const items = (await res.json()) as Array<{ id: string | null; name: string }>
    let files: string[] = []

    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) {
        const subFiles = await listAllFiles(fullPath)
        files = files.concat(subFiles)
      } else {
        files.push(fullPath)
      }
    }
    return files
  }

  const filesToDelete = await listAllFiles()
  console.log(`  Found ${filesToDelete.length} files in bucket '${bucketId}'.`)

  if (filesToDelete.length > 0) {
    const delRes = await fetch(`${supabaseUrl}/storage/v1/object/${bucketId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefixes: filesToDelete,
      }),
    })

    if (delRes.ok) {
      console.log(`  [PASS] Successfully deleted ${filesToDelete.length} files from '${bucketId}'.`)
    } else {
      const err = await delRes.text().catch(() => '')
      console.error(`  [FAIL] Failed to delete files in '${bucketId}': ${err}`)
    }
  }
}

async function main() {
  console.log('=== PURGING ALL SHOWROOM TEST DATA ===\n')

  // 1. Delete all records from showroom_images
  const deleted = await db.delete(showroomImages).returning()
  console.log(`1. Deleted ${deleted.length} records from 'showroom_images' table.`)

  // 2. Empty all storage buckets
  console.log('\n2. Emptying Supabase Storage showroom buckets:')
  for (const bucket of BUCKETS) {
    await emptyBucket(bucket)
  }

  // 3. Confirm 0 records
  const remaining = await db.select().from(showroomImages)
  console.log(`\n3. Final count in 'showroom_images': ${remaining.length} records.`)

  console.log('\n=== ALL SHOWROOM TEST DATA PURGED CLEANLY ===')
  process.exit(0)
}

main().catch((err) => {
  console.error('Purge error:', err)
  process.exit(1)
})
