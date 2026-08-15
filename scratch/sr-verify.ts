import 'dotenv/config'

/**
 * Cache-FREE Sales Report verification.
 *
 * ⚠️ THE FIX FOR THE PREVIOUS FALSE RESULTS. Earlier attempts compared runs while Redis still held
 * values (and `invalidateCachePattern` died once with a libuv assertion on exit), so two harnesses
 * disagreed about the same window. Clearing these two env vars BEFORE anything imports the cache
 * layer makes `getRedisClient()` return null, so `getCachedData` uses only its in-process L1 map —
 * empty at process start. Every run therefore computes from the database, deterministically.
 *
 *   tsx scratch/sr-verify.ts save     -> scratch/sr-snapshot.json
 *   tsx scratch/sr-verify.ts compare  -> deep-diffs current output against it
 */
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const FILE = 'scratch/sr-snapshot.json'

const WINDOWS = [
  { label: 'Jul-2026 all', args: { year: 2026, month: 6 } },
  { label: 'Jun-2026 all', args: { year: 2026, month: 5 } },
  { label: 'Aug-2026 all', args: { year: 2026, month: 7 } },
  { label: 'Jul-2026 JK402', args: { year: 2026, month: 6, dealerCode: 'JK402' } },
  { label: 'Jul-2026 JK501', args: { year: 2026, month: 6, dealerCode: 'JK501' } },
] as const

const diffs: string[] = []
function walk(a: unknown, b: unknown, path: string) {
  if (diffs.length > 30 || a === b) return
  if (typeof a !== typeof b || a === null || b === null) { diffs.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`); return }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push(`${path}.length: ${a.length} -> ${b.length}`)
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`)
    return
  }
  if (typeof a === 'object') {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
      walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
    }
    return
  }
  diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
}

async function main() {
  const { getKiaSalesReportSummary } = await import('../lib/kia/sales-report')
  const mode = process.argv[2] || 'save'
  const out: Record<string, unknown> = {}
  let total = 0
  for (const w of WINDOWS) {
    const s = Date.now()
    out[w.label] = await getKiaSalesReportSummary(w.args as never)
    const ms = Date.now() - s
    total += ms
    console.log(`  ${w.label.padEnd(16)} ${String(ms).padStart(6)}ms`)
  }
  console.log(`  ${'TOTAL'.padEnd(16)} ${String(total).padStart(6)}ms  (all cold — no cache)`)

  if (mode === 'save') {
    writeFileSync(FILE, JSON.stringify(out, null, 1))
    console.log(`\nsnapshot -> ${FILE}`)
    return
  }
  if (!existsSync(FILE)) throw new Error('no snapshot — run `save` first')
  const base = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>
  let bad = 0
  for (const w of WINDOWS) {
    diffs.length = 0
    walk(base[w.label], out[w.label], w.label)
    if (!diffs.length) { console.log(`  ✅ ${w.label}`); continue }
    bad++
    console.log(`  ❌ ${w.label} — ${diffs.length} differing path(s)`)
    for (const d of diffs.slice(0, 6)) console.log('       ' + d.slice(0, 170))
  }
  console.log(bad ? `\n❌ ${bad} window(s) changed` : '\n✅ ALL WINDOWS BYTE-IDENTICAL')
  process.exitCode = bad ? 1 : 0
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
