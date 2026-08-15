import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { getKiaSalesReportSummary } from '../lib/kia/sales-report'

/**
 * Capture (or compare against) the Sales Report summary output.
 *
 *   tsx scratch/salesreport-baseline.ts save     -> writes scratch/salesreport-baseline.json
 *   tsx scratch/salesreport-baseline.ts compare  -> diffs current output against it
 *
 * This is the safety net for a change that touches calculation code: every figure must be
 * byte-identical before and after.
 */

const FILE = 'scratch/salesreport-baseline.json'

const WINDOWS = [
  { label: 'Jul-2026 all', args: { year: 2026, month: 6 } },
  { label: 'Jun-2026 all', args: { year: 2026, month: 5 } },
  { label: 'Aug-2026 all', args: { year: 2026, month: 7 } },
  { label: 'Jul-2026 JK402', args: { year: 2026, month: 6, dealerCode: 'JK402' } },
  { label: 'Jul-2026 JK501', args: { year: 2026, month: 6, dealerCode: 'JK501' } },
] as const

async function capture() {
  const out: Record<string, unknown> = {}
  for (const w of WINDOWS) {
    const started = Date.now()
    out[w.label] = await getKiaSalesReportSummary(w.args as never)
    console.log(`  ${w.label.padEnd(16)} ${String(Date.now() - started).padStart(6)}ms`)
  }
  return out
}

async function main() {
  const mode = process.argv[2] || 'save'
  console.log(`mode: ${mode}\n`)
  const current = await capture()

  if (mode === 'save') {
    writeFileSync(FILE, JSON.stringify(current, null, 1))
    console.log(`\nbaseline written -> ${FILE}`)
    return
  }

  if (!existsSync(FILE)) throw new Error('no baseline saved — run with `save` first')
  const baseline = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>

  let mismatches = 0
  for (const w of WINDOWS) {
    const a = JSON.stringify(baseline[w.label])
    const b = JSON.stringify(current[w.label])
    if (a === b) { console.log(`  ✅ ${w.label} — identical`); continue }
    mismatches++
    console.log(`  ❌ ${w.label} — DIFFERS`)
    // Show the first differing top-level key so the cause is obvious.
    const ao = (baseline[w.label] || {}) as Record<string, unknown>
    const bo = (current[w.label] || {}) as Record<string, unknown>
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const av = JSON.stringify(ao[k]), bv = JSON.stringify(bo[k])
      if (av !== bv) console.log(`       key "${k}":\n         before ${String(av).slice(0, 220)}\n         after  ${String(bv).slice(0, 220)}`)
    }
  }
  console.log(mismatches ? `\n❌ ${mismatches} window(s) changed — DO NOT SHIP` : '\n✅ every window byte-identical')
  process.exitCode = mismatches ? 1 : 0
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
