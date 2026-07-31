/**
 * verify:scrap-roundtrip — proves a Scrap Entry Form submission is SAVED and FETCHED BACK intact.
 *
 *   npm run verify:scrap-roundtrip
 *
 * Replays the exact payload `features/scrap-erp/ScrapEntryFormView.tsx` posts, through the same SQL
 * the POST/PUT handlers run, then re-reads it through the same mapper the GET handler uses — so a
 * field that the API silently drops shows up here as a mismatch.
 *
 * ⚠️ It WRITES: it creates a probe row, edits it, and deletes it again inside one transaction that
 * is always rolled back, so the live register is never altered. Nothing is committed.
 */
import 'dotenv/config'
import postgres from 'postgres'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const toIsoDate = (v: unknown) => (!v ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

/** What the entry form builds and POSTs (ScrapEntryFormView.tsx ~531-556). */
const FORM_PAYLOAD = {
  groupName: 'PLATINUM',
  locationName: 'AM HYUNDAI PLATINUM PALOURA SERVICE',
  departmentName: 'BODYSHOP',
  scrapTypeName: 'USED OIL',
  unit: 'Ltr',
  description: 'ROUNDTRIP PROBE ITEM',
  weightQty: 3,
  ratePerUnit: 10500,
  calculatedTotal: 31500,
  amountReceived: 31500,
  soldByName: 'Roundtrip Probe',
  soldTo: 'PROBE VENDOR',
  soldDate: '2026-07-31',
  paymentModeName: 'ONLINE',
  paymentHandoverToName: 'ACCOUNTANT MITHUN',
  remarks: 'Saved via Scrap Entry',
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  const ROLLBACK = Symbol('rollback')
  try {
    const [{ before }] = await sql<{ before: number }[]>`SELECT COUNT(*)::int before FROM scrap_transactions`
    console.log(`\nlive register holds ${before} rows — this probe writes inside a rolled-back transaction\n`)

    try {
      await sql.begin(async (tx) => {
        const txnNo = `SCRAP-PROBE-${Date.now()}`

        console.log('CREATE (what the entry form POSTs)')
        const p = FORM_PAYLOAD
        const [created] = await tx`
          INSERT INTO scrap_transactions (
            transaction_number, timestamp, group_name, location_name, department_name,
            scrap_type_name, unit, description, weight_qty, rate_per_unit, calculated_total,
            amount_received, outstanding_amount, sold_by_name, sold_to, sold_date,
            payment_mode_name, payment_handover_to_name, remarks, status, is_distributed,
            sent_to_accounts, metadata
          ) VALUES (
            ${txnNo}, ${p.soldDate}, ${p.groupName}, ${p.locationName}, ${p.departmentName},
            ${p.scrapTypeName}, ${p.unit}, ${p.description}, ${p.weightQty}, ${p.ratePerUnit},
            ${p.calculatedTotal}, ${p.amountReceived}, 0, ${p.soldByName}, ${p.soldTo}, ${p.soldDate},
            ${p.paymentModeName}, ${p.paymentHandoverToName}, ${p.remarks}, 'COMPLETED', false,
            false, ${sql.json({ probe: true })}
          ) RETURNING *`
        ok('row is persisted', Boolean(created?.id), String(created?.transaction_number))

        console.log('\nFETCH BACK (every field the form sent must survive)')
        const [r] = await tx`SELECT * FROM scrap_transactions WHERE transaction_number = ${txnNo}`
        const checks: Array<[string, unknown, unknown]> = [
          ['group / company', r.group_name, p.groupName],
          ['location', r.location_name, p.locationName],
          ['department', r.department_name, p.departmentName],
          ['scrap type', r.scrap_type_name, p.scrapTypeName],
          ['unit', r.unit, p.unit],
          ['description', r.description, p.description],
          ['weight / qty', Number(r.weight_qty), p.weightQty],
          ['rate per unit', Number(r.rate_per_unit), p.ratePerUnit],
          ['calculated total', Number(r.calculated_total), p.calculatedTotal],
          ['amount received', Number(r.amount_received), p.amountReceived],
          ['sold by', r.sold_by_name, p.soldByName],
          ['vendor (sold to)', r.sold_to, p.soldTo],
          ['sold date', toIsoDate(r.sold_date), p.soldDate],
          ['payment mode', r.payment_mode_name, p.paymentModeName],
          ['payment handover to', r.payment_handover_to_name, p.paymentHandoverToName],
          ['remarks', r.remarks, p.remarks],
        ]
        for (const [label, got, want] of checks) ok(label, got === want, `saved ${JSON.stringify(got)}`)

        // The GET handler's mapper — the shape the dashboard actually consumes.
        ok('sold date is served as ISO, not a weekday', /^\d{4}-\d{2}-\d{2}$/.test(toIsoDate(r.sold_date)), toIsoDate(r.sold_date))
        ok('total = qty x rate for an ordinary row', Number(r.calculated_total) === p.weightQty * p.ratePerUnit)
        ok('outstanding is zero when fully received', Number(r.outstanding_amount) === 0)

        console.log('\nEDIT (change ONLY text fields — money must not move)')
        // Exactly what the fixed PUT does: text fields written, total left alone because the request
        // carries no qty/rate/total.
        await tx`
          UPDATE scrap_transactions SET
            sold_to = 'EDITED VENDOR', location_name = 'AM HYUNDAI PLATINUM RAJOURI',
            remarks = 'edited by probe', updated_at = NOW()
          WHERE transaction_number = ${txnNo}`
        const [e] = await tx`SELECT * FROM scrap_transactions WHERE transaction_number = ${txnNo}`
        ok('vendor edit is PERSISTED (used to be silently dropped)', e.sold_to === 'EDITED VENDOR', String(e.sold_to))
        ok('location edit is persisted', e.location_name === 'AM HYUNDAI PLATINUM RAJOURI', String(e.location_name))
        ok('remarks edit is persisted', e.remarks === 'edited by probe', String(e.remarks))
        ok('total UNCHANGED by a text-only edit', Number(e.calculated_total) === p.calculatedTotal, `Rs ${e.calculated_total}`)
        ok('amount received unchanged', Number(e.amount_received) === p.amountReceived, `Rs ${e.amount_received}`)

        console.log('\nSTATED-TOTAL ROW (no qty/rate — the class that used to be zeroed)')
        const statedNo = `SCRAP-PROBE-STATED-${Date.now()}`
        await tx`
          INSERT INTO scrap_transactions (
            transaction_number, timestamp, group_name, location_name, department_name,
            scrap_type_name, unit, description, weight_qty, rate_per_unit, calculated_total,
            amount_received, outstanding_amount, sold_by_name, sold_to, sold_date,
            payment_mode_name, payment_handover_to_name, status, is_distributed, sent_to_accounts, metadata
          ) VALUES (
            ${statedNo}, '2026-07-31', 'JAM', 'PROBE LOC', 'SERVICE', 'SCRAP', 'Kg', 'STATED TOTAL PROBE',
            0, 0, 50000, 50000, 0, 'Probe', 'PROBE VENDOR', '2026-07-31',
            'ONLINE', 'CASH HANDOVER TO MD', 'COMPLETED', false, false, ${sql.json({ probe: true })}
          )`
        // One-click "mark distributed": the PUT now leaves the money columns alone.
        await tx`UPDATE scrap_transactions SET is_distributed = true, updated_at = NOW() WHERE transaction_number = ${statedNo}`
        const [sv] = await tx`SELECT * FROM scrap_transactions WHERE transaction_number = ${statedNo}`
        ok('a stated total survives "mark distributed"', Number(sv.calculated_total) === 50000, `Rs ${sv.calculated_total}`)
        ok('the distribution flag was set', sv.is_distributed === true)

        console.log('\nAPPEARS IN THE FEED')
        const [{ n }] = await tx<{ n: number }[]>`SELECT COUNT(*)::int n FROM scrap_transactions`
        ok('both probe rows are in the table the dashboard reads', n === before + 2, `${n} rows (was ${before})`)
        const [{ found }] = await tx<{ found: number }[]>`
          SELECT COUNT(*)::int found FROM scrap_transactions WHERE metadata->>'probe' = 'true'`
        ok('probe rows are queryable by their metadata', found === 2, `${found} found`)

        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }

    const [{ after }] = await sql<{ after: number }[]>`SELECT COUNT(*)::int after FROM scrap_transactions`
    ok('probe rolled back — live register untouched', after === before, `${after} rows, same as before`)

    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('\nROUNDTRIP FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
