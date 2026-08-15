import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { getKiaSalesReportSummary } from '../lib/kia/sales-report'

/** Find the EXACT paths that differ between the baseline and the current output. */

const baseline = JSON.parse(readFileSync('scratch/salesreport-baseline.json', 'utf8')) as Record<string, unknown>

const WINDOWS = [
  { label: 'Jul-2026 all', args: { year: 2026, month: 6 } },
  { label: 'Jul-2026 JK501', args: { year: 2026, month: 6, dealerCode: 'JK501' } },
] as const

const diffs: string[] = []

function walk(a: unknown, b: unknown, path: string) {
  if (diffs.length > 40) return
  if (a === b) return
  if (typeof a !== typeof b || a === null || b === null) {
    diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push(`${path}.length: ${a.length} -> ${b.length}`)
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`)
    return
  }
  if (typeof a === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
    return
  }
  diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
}

async function main() {
  for (const w of WINDOWS) {
    diffs.length = 0
    const current = await getKiaSalesReportSummary(w.args as never)
    walk(baseline[w.label], current, w.label)
    console.log(`\n=== ${w.label}: ${diffs.length ? diffs.length + ' differing path(s)' : 'IDENTICAL'}`)
    for (const d of diffs.slice(0, 20)) console.log('   ' + d.slice(0, 190))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
