/**
 * repair-md-approved-accounts.ts
 * ---------------------------------------------------------------------------
 * REMEDIATION for the vendor-payment separation-of-duties defect.
 *
 * Until this was fixed, the MD/CEO was authorised on the `accounts` and
 * `payment_done` stages of a vendor payment request (server single-action route,
 * server bulk-action route, and two client guards). Worse, the moment an MD
 * approved at the `md` stage the row re-rendered and the SAME green quick-approve
 * button silently became the Accounts / Record-Payment action — so a second click
 * (or a double-click) recorded the payment. The result: requests marked
 * account_approval = 'APPROVED' and payment_status = 'PAID' that the Accounts
 * department never approved.
 *
 * This script finds those rows and rolls back ONLY the Accounts stage, returning
 * them to the Accounts queue for a genuine approval.
 *
 * The MD approval itself was legitimate — `management_approval` and `vp_approval`
 * are left untouched. Existing history is never deleted, only appended to.
 *
 * It also repairs a `history` column corruption — see PHASE 2 below.
 *
 * Usage:
 *   npm run repair:md-accounts              # DRY RUN — prints, writes nothing
 *   npm run repair:md-accounts -- --apply   # writes (backs up first)
 *
 * Flags:
 *   --apply     actually perform the writes (default is dry run)
 *   --json      also dump the full candidate objects as JSON
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const DUMP_JSON = process.argv.includes('--json')

// Roles that must NEVER have been able to action the Accounts stage.
const MD_ROLES = new Set(['md', 'ceo'])

// Stage keys that belong to the Accounts department.
const ACCOUNTS_STAGE_KEYS = new Set(['accounts', 'payment_done'])

/**
 * email_send_status is set to 'Completed' by the Accounts approval. There is no
 * stored history of the previous value, but the workflow only ever has one
 * pre-completion state for a request that reached the Accounts stage without
 * being rejected/held/sent back: 'Mail Sent' (confirmed against production — all
 * 22 rows currently awaiting Accounts carry exactly this value).
 */
const DEFAULT_PRE_COMPLETION_EMAIL_STATUS = 'Mail Sent'

type HistoryEntry = {
  id?: string
  role?: string
  roleKey?: string
  user?: string
  action?: string
  remarks?: string
  timestamp?: string
}

type ApprovalRow = {
  id: string
  name: string | null
  vendor_name: string | null
  amount: string
  department: string | null
  approval_type: string | null
  vp_approval: string | null
  management_approval: string | null
  account_approval: string | null
  payment_status: string | null
  payment_completed_by: string | null
  payment_completed_at: Date | null
  email_send_status: string | null
  utr_number: string | null
  payment_proof_url: string | null
  invoice_number: string | null
  history_type: string | null
  history: HistoryEntry[] | string | null
}

function fmtAmount(amount: string) {
  const n = Number(amount)
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : amount
}

/**
 * Read `history` defensively.
 *
 * `history` is jsonb and is SUPPOSED to hold an array. An earlier version of this script
 * wrote it with `${JSON.stringify(history)}::jsonb`, which postgres.js binds as a json
 * parameter and therefore JSON-encodes a SECOND time — storing the array as a jsonb
 * *string* ("[{...}]") instead of a jsonb array. Verified against the live database:
 *
 *     jsonb_typeof(${JSON.stringify(arr)}::jsonb)        -> 'string'   (wrong)
 *     jsonb_typeof(${JSON.stringify(arr)}::text::jsonb)  -> 'array'    (correct)
 *     jsonb_typeof(${sql.json(arr)})                     -> 'array'    (correct — used below)
 *
 * This helper transparently un-wraps that double encoding so a re-run heals the damage
 * rather than compounding it.
 */
function normalizeHistory(raw: HistoryEntry[] | string | null | undefined): HistoryEntry[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* fall through */
    }
  }
  return []
}

async function main() {
  const url =
    process.env.DATABASE_SESSION_URL ||
    process.env.DATABASE_DIRECT_URL ||
    process.env.DATABASE_URL

  if (!url) {
    console.error('FATAL: no database URL (DATABASE_SESSION_URL / DATABASE_DIRECT_URL / DATABASE_URL).')
    process.exit(1)
  }

  const sql = postgres(url, { prepare: false, max: 1 })

  try {
    // ── 1. Build the actor -> app role map ────────────────────────────────────
    // The history entry's `role` field is the STAGE LABEL ('MD', 'Accounts (Invoice)'),
    // NOT the actor's application role — so it cannot be used to identify an MD.
    // The only link back to the acting user is `user`, which stores appUser.fullName.
    const userRows = (await sql`
      SELECT full_name, role FROM users WHERE full_name IS NOT NULL
    `) as unknown as { full_name: string; role: string | null }[]

    const rolesByName = new Map<string, Set<string>>()
    for (const u of userRows) {
      const key = u.full_name.trim().toLowerCase()
      if (!rolesByName.has(key)) rolesByName.set(key, new Set())
      if (u.role) rolesByName.get(key)!.add(u.role.trim().toLowerCase())
    }

    const isMdActor = (actor: string | undefined) => {
      if (!actor) return false
      const roles = rolesByName.get(actor.trim().toLowerCase())
      if (!roles) return false
      for (const r of roles) if (MD_ROLES.has(r)) return true
      return false
    }

    const actorRoles = (actor: string | undefined) => {
      if (!actor) return '(unknown user)'
      const roles = rolesByName.get(actor.trim().toLowerCase())
      return roles && roles.size ? [...roles].join('/') : '(no matching user record)'
    }

    // ── 2. Load every row whose Accounts stage has been actioned ──────────────
    const rows = (await sql`
      SELECT id, name, vendor_name, amount, department, approval_type,
             vp_approval, management_approval, account_approval, payment_status,
             payment_completed_by, payment_completed_at, email_send_status,
             utr_number, payment_proof_url, invoice_number,
             jsonb_typeof(history) AS history_type, history
      FROM kia_approval_requests
      WHERE account_approval IS NOT NULL AND account_approval <> ''
      ORDER BY payment_completed_at NULLS LAST, id
    `) as unknown as ApprovalRow[]

    console.log(`Rows with an actioned Accounts stage: ${rows.length}`)

    // ── 3. Classify ───────────────────────────────────────────────────────────
    const affected: {
      row: ApprovalRow
      accountsEntries: HistoryEntry[]
      mdActors: string[]
      completedByIsMd: boolean
    }[] = []
    const genuine: { row: ApprovalRow; approvers: string[] }[] = []

    for (const row of rows) {
      const history = normalizeHistory(row.history)
      const accountsEntries = history.filter((h) => ACCOUNTS_STAGE_KEYS.has(String(h.roleKey)))

      const mdAccountsEntries = accountsEntries.filter((h) => isMdActor(h.user))
      const completedByIsMd = isMdActor(row.payment_completed_by ?? undefined)

      if (mdAccountsEntries.length > 0 || completedByIsMd) {
        affected.push({
          row,
          accountsEntries,
          mdActors: [...new Set(mdAccountsEntries.map((h) => h.user!).filter(Boolean))],
          completedByIsMd,
        })
      } else {
        genuine.push({
          row,
          approvers: [...new Set(accountsEntries.map((h) => h.user ?? '(no history entry)'))],
        })
      }
    }

    // ── 4. Report ─────────────────────────────────────────────────────────────
    console.log(`\n${'='.repeat(100)}`)
    console.log(`AFFECTED — Accounts stage actioned by an MD/CEO: ${affected.length} row(s)`)
    console.log('='.repeat(100))

    let totalAmount = 0
    for (const a of affected) {
      const r = a.row
      totalAmount += Number(r.amount) || 0
      const acctEntry = a.accountsEntries.find((h) => isMdActor(h.user)) ?? a.accountsEntries[0]
      const mdStage = normalizeHistory(r.history).filter((h) => h.roleKey === 'md')
      const mdStageEntry = mdStage[mdStage.length - 1]

      const gapSeconds =
        mdStageEntry?.timestamp && acctEntry?.timestamp
          ? Math.round(
              (new Date(acctEntry.timestamp).getTime() - new Date(mdStageEntry.timestamp).getTime()) / 1000
            )
          : null

      console.log(`\n  ${r.id}`)
      console.log(`    Requester / Vendor : ${r.name ?? '-'} / ${r.vendor_name ?? '-'}`)
      console.log(`    Amount             : INR ${fmtAmount(r.amount)}`)
      console.log(`    Dept / Type        : ${r.department ?? '-'} / ${r.approval_type ?? '-'}`)
      console.log(
        `    Accounts approved  : ${acctEntry?.user ?? '(none)'} [${actorRoles(acctEntry?.user)}] at ${acctEntry?.timestamp ?? '-'}`
      )
      console.log(
        `    MD stage approved  : ${mdStageEntry?.user ?? '(none)'} [${actorRoles(mdStageEntry?.user)}] at ${mdStageEntry?.timestamp ?? '-'}`
      )
      if (gapSeconds !== null) {
        console.log(
          `    Gap MD -> Accounts : ${gapSeconds}s${gapSeconds <= 120 ? '   <-- same session, consistent with the double-click defect' : ''}`
        )
      }
      console.log(
        `    payment_completed_by: ${r.payment_completed_by ?? '-'} [${actorRoles(r.payment_completed_by ?? undefined)}]${a.completedByIsMd ? '  <-- MD' : ''}`
      )
      console.log(
        `    Current state      : account_approval=${r.account_approval} payment_status=${r.payment_status} email_send_status=${r.email_send_status} utr=${r.utr_number ?? '-'} proof=${r.payment_proof_url ? 'yes' : '-'} invoice=${r.invoice_number ?? '-'}`
      )
      console.log(
        `    WILL RESET TO      : account_approval='' payment_status='PENDING' utr/proof/completed_at/completed_by=NULL email_send_status='${DEFAULT_PRE_COMPLETION_EMAIL_STATUS}'`
      )
      console.log(`    UNTOUCHED          : management_approval=${r.management_approval} vp_approval=${r.vp_approval}`)
    }

    console.log(`\n  TOTAL AFFECTED VALUE: INR ${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

    console.log(`\n${'='.repeat(100)}`)
    console.log(`NOT AFFECTED — genuinely approved by Accounts, left alone: ${genuine.length} row(s)`)
    console.log('='.repeat(100))
    for (const g of genuine) {
      console.log(
        `  ${g.row.id} | INR ${fmtAmount(g.row.amount).padStart(12)} | approved by: ${g.approvers
          .map((u) => `${u} [${actorRoles(u)}]`)
          .join(', ')}`
      )
    }

    if (DUMP_JSON) {
      console.log('\nFULL AFFECTED ROWS JSON:')
      console.log(JSON.stringify(affected.map((a) => a.row), null, 2))
    }

    // ── PHASE 2. `history` column corruption (double-encoded jsonb) ────────────
    // See normalizeHistory() above for the cause. A corrupted row is dangerous well
    // beyond this script: the app reads history with `Array.isArray(row.history)`, so a
    // jsonb *string* reads as "no history" — the timeline renders empty AND the next
    // approval action REPLACES the column with a fresh single-entry array, destroying the
    // whole audit trail. Any SQL using jsonb_array_elements(history) also errors outright.
    const corrupted = (await sql`
      SELECT id, name, vendor_name, amount, department, approval_type,
             vp_approval, management_approval, account_approval, payment_status,
             payment_completed_by, payment_completed_at, email_send_status,
             utr_number, payment_proof_url, invoice_number,
             jsonb_typeof(history) AS history_type, history
      FROM kia_approval_requests
      WHERE history IS NOT NULL AND jsonb_typeof(history) <> 'array'
      ORDER BY id
    `) as unknown as ApprovalRow[]

    const recoverable = corrupted.filter((r) => normalizeHistory(r.history).length > 0)
    const unrecoverable = corrupted.filter((r) => normalizeHistory(r.history).length === 0)

    console.log(`\n${'='.repeat(100)}`)
    console.log(`HISTORY COLUMN CORRUPTION — history stored as jsonb string, not array: ${corrupted.length} row(s)`)
    console.log('='.repeat(100))
    for (const r of corrupted) {
      const entries = normalizeHistory(r.history)
      console.log(
        `  ${r.id} | ${r.name ?? '-'} | INR ${fmtAmount(r.amount)} | jsonb_typeof=${r.history_type} | recoverable entries=${entries.length}${entries.length === 0 ? '  *** UNRECOVERABLE ***' : ''}`
      )
    }
    if (unrecoverable.length > 0) {
      console.log(`\n  WARNING: ${unrecoverable.length} row(s) could not be parsed back into an array and will be SKIPPED.`)
    }
    if (recoverable.length > 0) {
      console.log(`\n  ${recoverable.length} row(s) will have history rewritten as a proper jsonb array (content unchanged).`)
    }

    if (affected.length === 0 && recoverable.length === 0) {
      console.log('\nNothing to repair.')
      await sql.end()
      return
    }

    if (!APPLY) {
      console.log(`\n${'*'.repeat(100)}`)
      console.log('DRY RUN — no changes were written. Re-run with --apply to perform the repair.')
      console.log('*'.repeat(100))
      await sql.end()
      return
    }

    // ── 5. Back up BEFORE writing. Refuse to write if the backup fails. ───────
    const backupDir = path.join(process.cwd(), 'scripts', 'backups')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = path.join(backupDir, `kia_approval_requests_md_accounts_${stamp}.json`)

    try {
      fs.mkdirSync(backupDir, { recursive: true })
      fs.writeFileSync(
        backupFile,
        JSON.stringify({ affected: affected.map((a) => a.row), corrupted }, null, 2),
        'utf8'
      )
      const written = fs.statSync(backupFile)
      if (!written.size) throw new Error('backup file is empty')
      console.log(`\nBackup written: ${backupFile} (${written.size} bytes)`)
    } catch (err) {
      console.error('\nFATAL: backup failed — refusing to write any changes.')
      console.error(err)
      await sql.end()
      process.exit(1)
    }

    // ── 6. Apply, in one transaction ──────────────────────────────────────────
    const correctionRemarks =
      'Automated correction: the Accounts stage on this request was auto-approved by an MD/CEO ' +
      'because the MD was wrongly authorised on the Accounts stage (and the quick-approve button ' +
      'silently switched to the Accounts action after MD approval). Accounts never approved this ' +
      'payment. The Accounts stage has been reset to pending and returned to the Accounts ' +
      'department for genuine approval. The MD approval itself stands and is unchanged.'

    await sql.begin(async (tx) => {
      for (const a of affected) {
        const history = [...normalizeHistory(a.row.history)]
        history.push({
          id: Math.random().toString(36).substring(7),
          role: 'System',
          roleKey: 'system_correction',
          user: 'System (repair-md-approved-accounts)',
          action: 'REVERTED TO ACCOUNTS',
          remarks: correctionRemarks,
          timestamp: new Date().toISOString(),
        })

        await tx`
          UPDATE kia_approval_requests
          SET account_approval    = '',
              payment_status      = 'PENDING',
              utr_number          = NULL,
              payment_proof_url   = NULL,
              payment_completed_at = NULL,
              payment_completed_by = NULL,
              email_send_status   = ${DEFAULT_PRE_COMPLETION_EMAIL_STATUS},
              history             = ${tx.json(history) as never},
              updated_at          = NOW()
          WHERE id = ${a.row.id}
        `
      }

      // PHASE 2 writes: re-store the double-encoded history as a real jsonb array.
      // Content is preserved exactly — only the encoding changes. `updated_at` is left
      // ALONE here so this technical fix does not masquerade as a workflow event.
      for (const r of recoverable) {
        const history = normalizeHistory(r.history)
        await tx`
          UPDATE kia_approval_requests
          SET history = ${tx.json(history) as never}
          WHERE id = ${r.id}
        `
      }
    })

    // Verify the encoding actually landed as an array before declaring success.
    const stillCorrupt = await sql`
      SELECT count(*)::int AS c FROM kia_approval_requests
      WHERE history IS NOT NULL AND jsonb_typeof(history) <> 'array'
    `
    console.log(`\nAPPLIED — ${affected.length} row(s) reset to the Accounts stage.`)
    console.log(`APPLIED — ${recoverable.length} row(s) had history re-encoded as a jsonb array.`)
    console.log(`Post-write check: rows with non-array history remaining = ${stillCorrupt[0].c}`)
    console.log(`Backup of the pre-change rows: ${backupFile}`)

    await sql.end()
  } catch (err) {
    console.error(err)
    try {
      await sql.end()
    } catch {
      /* ignore */
    }
    process.exit(1)
  }
}

main()
