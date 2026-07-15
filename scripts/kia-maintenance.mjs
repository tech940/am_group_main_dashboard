// Triggers the KIA booking maintenance sweeps (allocation expiry, dealer-hold expiry, sold-vehicle
// detection, transfer-missing) by calling the app's secret-gated cron endpoint. Idempotent.
//
// These sweeps used to run inside user read requests (booking detail / matching vehicles / stock),
// which burned Vercel Fluid CPU on the hottest endpoint. Reads are now read-only and this is the
// scheduled trigger — allocation reservations (72h/CSD-120h) and unpaid dealer holds (48h) only
// lapse when this runs, so keep it scheduled (see the -scheduler sibling, or point n8n/cron at it).
//
// Env: APP_URL (or NEXT_PUBLIC_APP_URL) + KIA_MAINTENANCE_SECRET
import 'dotenv/config'

const baseUrl = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const secret = process.env.KIA_MAINTENANCE_SECRET || ''
const url = `${baseUrl}/api/brands/kia/maintenance${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`

async function main() {
  const response = await fetch(url, { method: 'POST' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error(`[kia-maintenance] HTTP ${response.status}`, body)
    process.exit(1)
  }
  console.log(
    `[kia-maintenance] ok in ${body.durationMs ?? '?'}ms · holds expired=${body.expiredHolds ?? 0} · sold flagged=${body.soldFlagged ?? 0}`
      + (body.errors?.length ? ` · errors: ${body.errors.join(' | ')}` : '')
  )
}

main().catch((error) => { console.error('[kia-maintenance] failed:', error); process.exit(1) })
