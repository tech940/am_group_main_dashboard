/**
 * Applies lib/db/migrations/kia-discounts/0001_discount_without_booking.sql on the SESSION pooler (5432)
 * and proves it with probes inside a transaction that is always rolled back:
 *   - a discount with neither a booking nor a DMS customer is refused
 *   - a discount on a DMS customer alone is accepted
 * Idempotent.
 *
 *   npx tsx scripts/apply-kia-discount-migration.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  const pooled = process.env.DATABASE_URL
  if (!pooled) throw new Error('Neither DATABASE_DIRECT_URL nor DATABASE_URL is set')
  const url = new URL(pooled)
  if (url.port !== '6543') throw new Error(`Expected DATABASE_URL on 6543 to derive from; found ${url.port}`)
  url.port = '5432'
  return url.toString()
}

class Rollback extends Error {}

async function main() {
  const url = resolveDirectUrl()
  const parsed = new URL(url)
  if (parsed.port === '6543') throw new Error('Refusing to run DDL against the pgbouncer pooler on 6543.')
  console.log(`connecting to ${parsed.hostname}:${parsed.port}`)
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    await sql.unsafe(readFileSync('lib/db/migrations/kia-discounts/0001_discount_without_booking.sql', 'utf8'))
    console.log('kia-discounts/0001 applied.')
    const [user] = await sql`SELECT id FROM users WHERE is_active ORDER BY created_at LIMIT 1`
    const probes: string[] = []
    try {
      await sql.begin(async (tx) => {
        await tx`SAVEPOINT p`
        let refused = false
        try {
          await tx`INSERT INTO kia_booking_discounts (requested_amount, status, requested_by, requested_by_name) VALUES (1, 'PENDING', ${user.id}, 'probe')`
        } catch { refused = true }
        await tx`ROLLBACK TO SAVEPOINT p`
        if (!refused) throw new Error('a discount with no booking and no DMS customer was accepted')
        probes.push('a discount pointing at nothing is refused')
        await tx`INSERT INTO kia_booking_discounts (requested_amount, status, requested_by, requested_by_name, dms_customer_id, dms_booking_no)
                 VALUES (1, 'PENDING', ${user.id}, 'probe', 'C0000000000', 'B000000000')`
        probes.push('a discount on a DMS customer alone is accepted')
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    }
    for (const probe of probes) console.log('  probe ok:', probe)
    console.log('Probes rolled back. Done.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
