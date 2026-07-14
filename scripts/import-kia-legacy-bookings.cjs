/**
 * One-off import of the legacy "Bookings_Data.xlsx" sheet into kia_bookings.
 *
 * All rows belong to dealer JK402. Owner (created_by/updated_by) = Sanjeev Koul (sales@amkia.in),
 * the manager named on every row. Each row is imported as a fresh 'booking_created' booking, backdated
 * to its original BOOKING DATE, with the legacy status + every extra sheet column preserved in metadata
 * and a human note. Idempotent via metadata.naturalKey (safe to re-run).
 *
 *   Dry run (default, no writes):  node scripts/import-kia-legacy-bookings.cjs
 *   Commit:                        node scripts/import-kia-legacy-bookings.cjs commit
 */
require('dotenv/config')
const XLSX = require('xlsx')
const postgres = require('postgres')

const XLSX_PATH = 'C:/Users/sahil/Downloads/Bookings_Data.xlsx'
const DEALER = 'JK402'
const OWNER_EMAIL = 'sales@amkia.in'
const COMMIT = process.argv.includes('commit')

const s = (v) => String(v ?? '').trim()
const collapse = (v) => s(v).replace(/\s+/g, ' ')

// Parse DD/MM/YYYY (Indian format) -> Date at 12:00 IST (06:30 UTC) to avoid date-shift; null if bad.
function parseDMY(v) {
  const m = s(v).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (!m) return null
  let [, d, mo, y] = m
  d = +d; mo = +mo; y = +y
  if (y < 100) y += 2000
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d, 6, 30, 0))
  return Number.isNaN(dt.getTime()) ? null : dt
}
function toISODate(v) { const dt = parseDMY(v); return dt ? dt.toISOString().slice(0, 10) : null }

function normalizeBank(raw) {
  const u = s(raw).toUpperCase()
  if (!u) return { financed: false, bank: null }
  if (u === 'CASH') return { financed: false, bank: null }
  if (['JK BANK', 'JKBANK', 'JKB'].includes(u)) return { financed: true, bank: 'JK BANK' }
  if (u === 'JK GRAMEEN BANK') return { financed: true, bank: 'JK GRAMEEN BANK' }
  if (u === 'OTHERS') return { financed: true, bank: 'OTHERS' }
  return { financed: true, bank: s(raw).toUpperCase() }
}

function buildRecord(r) {
  const bookingDate = parseDMY(r['BOOKING DATE ']) || parseDMY(r['Timestamp'])
  const phoneRaw = s(r['Mobile number'])
  const phone = phoneRaw || '0000000000'
  const bank = normalizeBank(r['Bank Finance'])
  const legacyStatus = s(r['STATUS'])
  const estMonth = s(r['Actual Delivery Date'])
  const waiting = s(r['Wating Period'])
  const model = s(r['Model']).toUpperCase()
  const variant = s(r['Variant'])

  const noteBits = [`Imported from legacy Bookings sheet.`]
  if (legacyStatus) noteBits.push(`Legacy status: ${legacyStatus}.`)
  if (estMonth) noteBits.push(`Est. delivery: ${estMonth}.`)
  if (waiting) noteBits.push(`Waiting period: ${waiting}.`)
  if (!phoneRaw) noteBits.push(`Phone missing in source — placeholder used.`)

  const metadata = {
    importSource: 'legacy-bookings-xlsx',
    importedAt: new Date().toISOString(),
    legacyStatus,
    legacyRowTimestamp: s(r['Timestamp']),
    year: s(r['YEAR']),
    bankFinanceRaw: s(r['Bank Finance']),
    bookingAmount: s(r['BOOKING AMOUNT']),
    paymentSource: s(r['PMT SOURCE']),
    paymentAmountAboveBooking: s(r['PAYMENT AMOUNT (Any Payment greater than the booking amount)']),
    paymentReceivedAgainstBooking: s(r['Payment Recevied Against Booking ']),
    managerName: s(r['Manager Name']),
    tlName: s(r['TL Name']),
    consultantName: s(r['Consultant Name']),
    leadSource: s(r['Lead Source']),
    estimatedDeliveryMonth: estMonth,
    estimatedDeliveryDate: s(r['Estimated Delivery Date']),
    promiseDate: s(r['Promise date ']),
    waitingPeriod: waiting,
    anyCommitment: s(r['Any Commitment With Customer']),
    otherDealerDetails: s(r['OTHER DEALER DETAILS']),
    countryCode: s(r['Country Code']),
    costSheetUrl: s(r['COST SHEET']),
    emailStatus: s(r['Email Status']),
    phoneMissingInSource: !phoneRaw,
  }
  const naturalKey = `${DEALER}|${phone}|${model}|${variant.toLowerCase()}|${bookingDate ? bookingDate.toISOString().slice(0, 10) : 'nodate'}`
  metadata.naturalKey = naturalKey

  return {
    naturalKey,
    createdAt: bookingDate || new Date(),
    values: {
      status: 'booking_created',
      dealer_code: DEALER,
      customer_name: collapse(r['Customer Name ']),
      customer_phone: phone,
      customer_email: collapse(r['Customer Email Id ']) || null,
      customer_address: null,
      model,
      variant,
      color: collapse(r['COLOUR']) || null,
      fuel_type: collapse(r['FUEL TYPE']) || null,
      consultant_name: collapse(r['Consultant Name']) || 'Unknown',
      consultant_email: null,
      source: collapse(r['Lead Source']) || null,
      finance_required: bank.financed,
      bank_name: bank.bank,
      loan_amount: '0',
      delivery_target_date: toISODate(r['Estimated Delivery Date']),
      notes: noteBits.join(' '),
      metadata,
    },
  }
}

async function nextBookingNumber(sql) {
  const [{ seq }] = await sql`SELECT nextval('public.kia_booking_number_seq')::text AS seq`
  const n = String(parseInt(seq, 10) + 120000).padStart(6, '0')
  return `KIA_${DEALER}_${new Date().getFullYear()}_${n}`
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const wb = XLSX.readFile(XLSX_PATH)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
  const records = rows.map(buildRecord).filter((rec) => rec.values.customer_name && rec.values.model && rec.values.variant)

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })
  try {
    const [owner] = await sql`SELECT id, full_name, role FROM users WHERE lower(email) = ${OWNER_EMAIL} LIMIT 1`
    if (!owner) throw new Error(`Owner user ${OWNER_EMAIL} not found.`)

    // Which naturalKeys already exist (idempotency)?
    const keys = records.map((r) => r.naturalKey)
    const existing = await sql`SELECT metadata->>'naturalKey' AS k FROM kia_bookings WHERE metadata->>'naturalKey' = ANY(${keys})`
    const existingSet = new Set(existing.map((e) => e.k))
    const toInsert = records.filter((r) => !existingSet.has(r.naturalKey))

    const dates = records.map((r) => r.createdAt).sort((a, b) => a - b)
    console.log(`Owner: ${owner.full_name} (${OWNER_EMAIL}, ${owner.role})`)
    console.log(`Parsed ${records.length} records · already-imported ${existingSet.size} · to insert ${toInsert.length}`)
    console.log(`Date range: ${dates[0]?.toISOString().slice(0, 10)} → ${dates[dates.length - 1]?.toISOString().slice(0, 10)}`)
    console.log(`Financed: ${records.filter((r) => r.values.finance_required).length} · Cash: ${records.filter((r) => !r.values.finance_required).length} · Missing phone: ${records.filter((r) => r.values.metadata.phoneMissingInSource).length}`)
    console.log('\nSample (first 4 to insert):')
    for (const rec of toInsert.slice(0, 4)) {
      const v = rec.values
      console.log(`  ${rec.createdAt.toISOString().slice(0, 10)} | ${v.customer_name} | ${v.model} ${v.variant} | ${v.color} | ${v.finance_required ? v.bank_name : 'CASH'} | ${v.consultant_name} | ph:${v.customer_phone}`)
    }

    if (!COMMIT) {
      console.log('\n[DRY RUN] No rows written. Re-run with `commit` to insert.')
      process.exit(0)
    }

    let inserted = 0
    await sql.begin(async (tx) => {
      for (const rec of toInsert) {
        const bookingNumber = await nextBookingNumber(tx)
        const v = rec.values
        const [booking] = await tx`
          INSERT INTO kia_bookings (
            booking_number, status, dealer_code, customer_name, customer_phone, customer_email,
            customer_address, model, variant, color, fuel_type, consultant_name, consultant_email,
            source, finance_required, bank_name, loan_amount, delivery_target_date, notes, metadata,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${bookingNumber}, ${v.status}, ${v.dealer_code}, ${v.customer_name}, ${v.customer_phone}, ${v.customer_email},
            ${v.customer_address}, ${v.model}, ${v.variant}, ${v.color}, ${v.fuel_type}, ${v.consultant_name}, ${v.consultant_email},
            ${v.source}, ${v.finance_required}, ${v.bank_name}, ${v.loan_amount}, ${v.delivery_target_date}, ${v.notes}, ${sql.json(v.metadata)},
            ${owner.id}, ${owner.id}, ${rec.createdAt}, ${rec.createdAt}
          ) RETURNING id`
        await tx`
          INSERT INTO kia_booking_activity (booking_id, activity_type, title, description, after_value, actor_user_id, actor_name, actor_role, created_at)
          VALUES (${booking.id}, 'created', 'Booking imported', ${`Imported from legacy sheet — ${v.customer_name}, ${v.model} ${v.variant}`}, ${sql.json({ bookingNumber, legacyStatus: v.metadata.legacyStatus })}, ${owner.id}, ${owner.full_name}, ${owner.role}, ${rec.createdAt})`
        inserted++
      }
    })
    console.log(`\n[COMMITTED] Inserted ${inserted} bookings (skipped ${existingSet.size} already present).`)
    process.exit(0)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((e) => { console.error('Import failed:', e); process.exit(1) })
