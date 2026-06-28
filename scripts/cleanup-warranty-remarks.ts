import 'dotenv/config'

import { Redis } from '@upstash/redis'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const WARRANTY_BUCKET = 'hyundai-warranty-claims'
const CACHE_KEYS = [
  'hyundai:warranty:claim_list:base',
  'hyundai:warranty:claim_list:base:stale',
  'hyundai:warranty:claim_list:base:actions',
  'hyundai:warranty:claim_list:base:actions:stale',
  'hyundai:warranty:ytp:base',
  'hyundai:warranty:ytp:base:stale',
  'hyundai:warranty:ytp:base:actions',
  'hyundai:warranty:ytp:base:actions:stale',
  'platinum:warranty:claim_list:base',
  'platinum:warranty:claim_list:base:stale',
  'platinum:warranty:claim_list:base:actions',
  'platinum:warranty:claim_list:base:actions:stale',
  'platinum:warranty:ytp:base',
  'platinum:warranty:ytp:base:stale',
  'platinum:warranty:ytp:base:actions',
  'platinum:warranty:ytp:base:actions:stale',
]

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function invalidateWarrantyCaches() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
  await redis.del(...CACHE_KEYS)
}

async function main() {
  const apply = process.argv.includes('--apply')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    const rows = await sql<{
      action_id: string
      storage_path: string | null
    }[]>`
      SELECT a.id::text AS action_id, e.storage_path
      FROM hyundai_warranty_claim_actions a
      LEFT JOIN hyundai_warranty_claim_evidence e ON e.action_id = a.id
      WHERE a.created_at < now() - interval '1 month'
    `

    const actionIds = [...new Set(rows.map((row) => row.action_id))]
    const storagePaths = [...new Set(rows.map((row) => row.storage_path).filter((path): path is string => Boolean(path)))]

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      oldRemarkActions: actionIds.length,
      evidenceFiles: storagePaths.length,
      cutoff: 'now() - interval 1 month',
    }, null, 2))

    if (!apply || actionIds.length === 0) return

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase service role credentials are required to delete warranty evidence files')
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    for (const paths of chunk(storagePaths, 100)) {
      const { error } = await supabase.storage.from(WARRANTY_BUCKET).remove(paths)
      if (error) throw error
    }

    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM hyundai_warranty_claim_actions
        WHERE id IN ${tx(actionIds)}
      `
    })

    await invalidateWarrantyCaches()
    console.log(`Deleted ${actionIds.length} old warranty remark(s) and ${storagePaths.length} evidence file(s).`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
