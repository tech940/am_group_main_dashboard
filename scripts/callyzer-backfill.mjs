// One-time (repeatable) Callyzer -> Postgres backfill. Standalone so it can run without the
// Next server. Sequential by design: Callyzer rejects concurrent requests (429) but is fine with
// back-to-back sequential ones.
//   node scripts/callyzer-backfill.mjs [days]
import 'dotenv/config'
import postgres from 'postgres'

const KEY = process.env.CALLYZER_API_KEY
if (!KEY) { console.error('CALLYZER_API_KEY not set'); process.exit(1) }
const DAYS = Math.min(180, Number(process.argv[2]) || 180)

const url = (process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '').replace(':6543', ':5432')
const sql = postgres(url, { prepare: false, ssl: 'require', max: 1 })

const BASE = 'https://api1.callyzer.co/api/v2.2'
const now = Math.floor(Date.now() / 1000)
const from = now - DAYS * 86400

const t = (v) => String(v ?? '').trim()
function syncedAt(v) {
  const raw = t(v)
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([A-Z]{2,4})?$/)
  if (!m) return null
  const [, d, tm, z] = m
  return `${d}T${tm}${z === 'UTC' || z === 'GMT' ? '+00:00' : '+05:30'}`
}

// Retry: Callyzer intermittently 400s with a raw JDBC exception from their own DB (seen on page 9
// mid-run; the same request succeeded immediately after). Without this a healthy sync aborts.
async function page(n, attempts = 4) {
  let last
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(`${BASE}/call-log/history`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_from: from, call_to: now, call_method: 'PhoneCall', call_mode: 'Voice',
          page_no: n, page_size: 100,
        }),
      })
      if (res.ok) return (await res.json()).result || []
      last = new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
      if (res.status === 401 || res.status === 403) throw last
    } catch (e) { last = e }
    if (a < attempts) {
      process.stdout.write(`
  page ${n} attempt ${a} failed, retrying...`)
      await new Promise((r) => setTimeout(r, a * 1500))
    }
  }
  throw last
}

try {
  const started = Date.now()
  let total = 0
  for (let p = 1; p <= 200; p++) {
    const rows = await page(p)
    if (rows.length) {
      await sql`
        INSERT INTO callyzer_calls ${sql(rows.map((r) => ({
          id: t(r.id),
          client_name: t(r.client_name),
          client_number: t(r.client_number),
          duration: Number(r.duration) || 0,
          call_type: t(r.call_type),
          call_date: t(r.call_date) || null,
          call_time: t(r.call_time),
          note: t(r.note),
          recording_url: t(r.call_recording_url),
          emp_name: t(r.emp_name) || 'Unassigned',
          emp_number: t(r.emp_number),
          emp_tags: Array.isArray(r.emp_tags) ? r.emp_tags.map(t) : [],
          crm_status: t(r.crm_status),
          call_method: t(r.call_method),
          call_mode: t(r.call_mode),
          synced_at: syncedAt(r.synced_at),
        })))}
        ON CONFLICT (id) DO UPDATE SET
          client_name = EXCLUDED.client_name,
          duration = EXCLUDED.duration,
          call_type = EXCLUDED.call_type,
          note = EXCLUDED.note,
          recording_url = COALESCE(NULLIF(EXCLUDED.recording_url, ''), callyzer_calls.recording_url),
          crm_status = EXCLUDED.crm_status,
          synced_at = EXCLUDED.synced_at,
          updated_at = now()
      `
      total += rows.length
      process.stdout.write(`\r  page ${p}: +${rows.length} (total ${total})   `)
    }
    if (rows.length < 100) break
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM callyzer_calls`
  const [{ rec }] = await sql`SELECT count(*)::int AS rec FROM callyzer_calls WHERE recording_url <> ''`
  await sql`
    UPDATE callyzer_sync_state
    SET last_synced_at = now(), last_run_at = now(), last_run_status = 'ok',
        last_run_detail = ${'backfill: ' + total + ' rows'}, total_calls = ${n}
    WHERE id = 1`
  console.log(`\n\nbackfill done in ${Math.round((Date.now() - started) / 1000)}s`)
  console.log(`  rows in table : ${n}`)
  console.log(`  with recording: ${rec} (${Math.round((rec / n) * 100)}%)`)
} catch (e) {
  console.error('\nFAILED:', e.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
