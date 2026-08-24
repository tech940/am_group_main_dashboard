/**
 * One-time import of the old "AM GROUP BANK SANCTION LIMITS FORM (Responses)" sheet into the
 * /bank-sanctions register.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/import-bank-sanctions.ts <responses.json>            (dry run)
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/import-bank-sanctions.ts <responses.json> --commit
 *
 * <responses.json> is the "Form Responses 1" sheet exported to JSON (one object per response row).
 * DRY RUN BY DEFAULT — the same convention as scrap:import, and for the same reason: an import that
 * writes on first invocation gets run twice.
 *
 * ── Shape of the source, and what this does with it ───────────────────────────────────────────
 * "Form Responses 1" is APPEND-ONLY HISTORY: the Apps Script appended a full snapshot on every
 * save, so its 563 rows describe only 73 facilities. Accordingly:
 *   - REGISTER  <- the LATEST row per facility (the sheet's own identity rule: loanTypeKey, i.e.
 *                  the last number in the loan-type name). createdAt = the facility's EARLIEST
 *                  response, updatedAt = its latest — the true lifetime, not the import moment.
 *   - HISTORY   <- EVERY response row, action 'imported', createdAt = the sheet timestamp, linked
 *                  to its facility's register record. The drawer's History tab then shows the
 *                  sheet's full trail as if the app had been there all along.
 *
 * ── Cleaning rules, each decided from a scan of the actual data ───────────────────────────────
 *   - ROI arrives as a FRACTION (percent-formatted cells: 0.1155 = 11.55%; scan: max 0.18, none
 *     above 1). Values <= 1 are multiplied by 100; anything above 1 is taken as already-percent.
 *   - 8 rows carry non-date strings in Date of Sanction ('22.04.2024', '10.11.2025',
 *     '12/26/0024' — a year-0024 typo). Parsed as dd.mm.yyyy / m/d/yyyy with two-digit years
 *     promoted to 20xx; anything unparseable imports as NULL and is reported, with the raw string
 *     preserved in the history snapshot.
 *   - Facilities whose key ALREADY EXISTS in the register are SKIPPED and reported — a record
 *     entered through the new UI is newer than the sheet and wins.
 *
 * All writes happen in ONE transaction: a partial import cannot exist.
 */
import 'dotenv/config'
import fs from 'fs'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { bankSanctionHistory, bankSanctionLimits } from '../lib/db/schema'
import { loanTypeKey } from '../lib/bank-sanctions/store'

type SheetRow = Record<string, unknown> & { timestamp: string | null; loanType: string | null }

const warnings: string[] = []

function text(v: unknown): string | null {
  const t = String(v ?? '').trim()
  return t ? t : null
}

function money(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) { warnings.push(`${label}: unusable number ${JSON.stringify(v)}`); return null }
  return n.toFixed(2)
}

function roi(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) { warnings.push(`ROI: unusable ${JSON.stringify(v)}`); return null }
  const pct = n <= 1 ? n * 100 : n
  if (pct > 100) { warnings.push(`ROI: implausible ${pct}%`); return null }
  return pct.toFixed(3)
}

function dateOf(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === '') return null
  const t = String(v).trim()
  // Python exported real date cells as ISO datetimes.
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // dd.mm.yyyy — hand-typed in a handful of old rows.
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // m/d/yyyy, tolerating the year-0024 typo (any year < 100 is promoted to 20xx).
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/)
  if (m) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  warnings.push(`${label}: unparseable date ${JSON.stringify(t)} — imported as NULL (raw kept in snapshot)`)
  return null
}

function email(v: unknown): string | null {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { warnings.push(`alert email invalid: ${JSON.stringify(t)}`); return null }
  return t
}

function clean(row: SheetRow) {
  return {
    loanType: text(row.loanType),
    location: text(row.location),
    creditLimit: money(row.creditLimit, 'creditLimit'),
    instalment: money(row.instalment, 'instalment'),
    roiPct: roi(row.roi),
    interestAmount: money(row.interestAmount, 'interestAmount'),
    outstandingAmount: money(row.outstandingAmount, 'outstandingAmount'),
    dateOfSanction: dateOf(row.dateOfSanction, 'dateOfSanction'),
    installmentDueOn: dateOf(row.installmentDueOn, 'installmentDueOn'),
    installmentPaidOn: dateOf(row.installmentPaidOn, 'installmentPaidOn'),
    expiryDate: dateOf(row.expiryDate, 'expiryDate'),
    guarantor: text(row.guarantor),
    collateral: text(row.collateral),
    primarySecurity: text(row.primarySecurity),
    corporateGuarantee: text(row.corporateGuarantee),
    documentUrl1: text(row.documentUrl1),
    documentUrl2: text(row.documentUrl2),
    alertEmail: email(row.alertEmail),
  }
}

async function main() {
  const [jsonPath, flag] = process.argv.slice(2)
  const commit = flag === '--commit'
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.error('Usage: import-bank-sanctions.ts <responses.json> [--commit]')
    process.exit(1)
  }

  const rows: SheetRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const usable = rows.filter((r) => text(r.loanType) && r.timestamp)
  console.log(`source: ${rows.length} response rows, ${usable.length} usable (loan type + timestamp present)`)

  // Group into facilities by the sheet's own identity rule.
  const byKey = new Map<string, SheetRow[]>()
  for (const row of usable) {
    const key = loanTypeKey(String(row.loanType))
    const bucket = byKey.get(key)
    if (bucket) bucket.push(row)
    else byKey.set(key, [row])
  }
  for (const bucket of byKey.values()) {
    bucket.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
  }

  // Records entered through the new UI win over the sheet.
  const existing = await db.select({ loanType: bankSanctionLimits.loanType }).from(bankSanctionLimits)
  const existingKeys = new Set(existing.map((r) => loanTypeKey(r.loanType)))
  const skipped: string[] = []
  const toImport: { key: string; responses: SheetRow[] }[] = []
  for (const [key, responses] of byKey) {
    if (existingKeys.has(key)) skipped.push(String(responses[responses.length - 1].loanType))
    else toImport.push({ key, responses })
  }

  let totalLimit = 0
  let totalOutstanding = 0
  const plans = toImport.map(({ responses }) => {
    const latest = responses[responses.length - 1]
    const values = clean(latest)
    totalLimit += Number(values.creditLimit || 0)
    totalOutstanding += Number(values.outstandingAmount || 0)
    return {
      values,
      createdAt: new Date(String(responses[0].timestamp)),
      updatedAt: new Date(String(latest.timestamp)),
      responses,
    }
  })

  console.log(`\nplan: ${plans.length} facilities -> register, ${usable.length} responses -> history`)
  console.log(`      register totals: limit Rs${(totalLimit / 1e7).toFixed(2)} Cr | outstanding Rs${(totalOutstanding / 1e7).toFixed(2)} Cr`)
  if (skipped.length) console.log(`      skipped (already in register via the app): ${skipped.join(' | ')}`)
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`)
    for (const w of Array.from(new Set(warnings))) console.log(`  - ${w}`)
  }

  if (!commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to import.')
    process.exit(0)
  }

  await db.transaction(async (tx) => {
    for (const plan of plans) {
      const [rec] = await tx.insert(bankSanctionLimits).values({
        ...plan.values,
        loanType: plan.values.loanType!,
        location: plan.values.location ?? 'UNKNOWN',
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      }).returning({ id: bankSanctionLimits.id })

      // Every sheet response becomes an 'imported' history entry at its ORIGINAL timestamp, so the
      // drawer's trail reads as the sheet's real timeline, not one flat import instant.
      const historyRows = plan.responses.map((response) => ({
        recordId: rec.id,
        action: 'imported',
        loanType: String(response.loanType),
        location: text(response.location) ?? 'UNKNOWN',
        snapshot: { ...clean(response), _raw: response } as Record<string, unknown>,
        changedBy: null,
        changedByEmail: null,
        createdAt: new Date(String(response.timestamp)),
      }))
      for (let i = 0; i < historyRows.length; i += 100) {
        await tx.insert(bankSanctionHistory).values(historyRows.slice(i, i + 100))
      }
    }
  })

  const [countCheck] = await db.execute(sql`
    SELECT (SELECT COUNT(*) FROM bank_sanction_limits)::int AS register,
           (SELECT COUNT(*) FROM bank_sanction_history)::int AS history,
           (SELECT ROUND(COALESCE(SUM(credit_limit),0)/1e7, 2) FROM bank_sanction_limits)::text AS limit_cr
  `) as unknown as [{ register: number; history: number; limit_cr: string }]
  console.log(`\nCOMMITTED. register=${countCheck.register} history=${countCheck.history} total limit Rs${countCheck.limit_cr} Cr`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('IMPORT FAILED (nothing partially written — single transaction):', e); process.exit(1) })
