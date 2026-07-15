// Triggers the automatic user-deactivation sweep by calling the app's secret-gated cron endpoint.
// Deactivates non-exempt users idle for 7+ days; md / ea / accounts / developer are never touched.
// Idempotent — already-inactive users are not re-selected.
//
// Pass --dry-run to report who WOULD be deactivated without writing anything.
// Pass --force to override the mass-lockout circuit breaker (see lib/auth/user-deactivation.ts).
//
// Env: APP_URL (or NEXT_PUBLIC_APP_URL) + USER_DEACTIVATION_SECRET (required — endpoint fails closed)
import 'dotenv/config'

const baseUrl = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const secret = process.env.USER_DEACTIVATION_SECRET || ''
const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

const params = new URLSearchParams()
if (secret) params.set('secret', secret)
if (dryRun) params.set('dryRun', '1')
if (force) params.set('force', '1')
const url = `${baseUrl}/api/maintenance/user-deactivation?${params.toString()}`

async function main() {
  const response = await fetch(url, { method: 'POST' })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    console.error(`[user-deactivation] HTTP ${response.status}`, body.error || body)
    process.exit(1)
  }

  const label = body.dryRun ? 'DRY RUN — would deactivate' : 'deactivated'
  console.log(`[user-deactivation] ok in ${body.durationMs ?? '?'}ms · ${label} ${body.dryRun ? body.candidates?.length ?? 0 : body.deactivated ?? 0} of ${body.eligible ?? 0} eligible (idle > ${body.idleDays ?? '?'}d)`)
  for (const candidate of body.candidates ?? []) {
    console.log(`  ${String(candidate.email).padEnd(38)} ${String(candidate.role).padEnd(18)} idle ${candidate.idleDays}d`)
  }
}

main().catch((error) => { console.error('[user-deactivation] failed:', error); process.exit(1) })
