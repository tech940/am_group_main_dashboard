/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const postgres = require('postgres')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const DEFAULT_FILE = 'C:\\Users\\HP\\Downloads\\MG PROFORMA (Responses).xlsx'

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const filePath = path.resolve(argValue('--file', DEFAULT_FILE))
const shouldApply = process.argv.includes('--apply')
const shouldSetup = process.argv.includes('--setup')
const shouldReplace = process.argv.includes('--replace')
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL

function cleanHeader(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/@1%|@9%/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function normalizeColour(value) {
  const text = toText(value)
  if (/^metalic$/i.test(text)) return 'Metallic'
  if (/^metallic$/i.test(text)) return 'Metallic'
  return text
}

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (value instanceof Date) return value.toISOString()
  const text = String(value).trim()
  if (!text || /^#+$/.test(text)) return fallback
  return text
}

function toEmail(value) {
  return toText(value).toLowerCase()
}

function toMobile(value) {
  const text = toText(value)
  if (!text) return ''
  return text.replace(/\.0$/, '').replace(/\D/g, '') || text
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value).replace(/rs\.?|₹|,/gi, '').replace(/[^0-9.-]/g, '').trim()
  if (!text || text === '-' || /^#+$/.test(text)) return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function excelSerialToDate(value) {
  const parsed = XLSX.SSF.parse_date_code(value)
  if (!parsed) return null
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0)))
}

function toDate(value) {
  if (!value && value !== 0) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number') return excelSerialToDate(value)
  const text = toText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return null
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)))
}

function get(row, ...names) {
  for (const name of names) {
    const key = cleanHeader(name)
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
  }
  return null
}

function readRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
  const headers = []
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })]
    const header = cleanHeader(cell ? cell.v : '')
    headers.push(header || `__empty_${col}`)
  }

  const rows = []
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const row = { __rowNumber: r + 1, __sheetName: sheetName }
    let hasValue = false
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      const value = cell && cell.t === 'd' && cell.w && !cell.w.includes(':') ? cell.w : (cell ? cell.v : null)
      if (!isBlank(value)) hasValue = true
      row[headers[c - range.s.c]] = value
    }
    if (hasValue) rows.push(row)
  }
  return rows
}

function normalizeStatus(value, checkedBy, emailSendStatus) {
  const explicit = toText(value)
  if (explicit) return explicit
  if (checkedBy && checkedBy.toUpperCase() === 'NOT APPROVED') return 'NOT APPROVED'
  if (checkedBy || emailSendStatus) return 'APPROVED'
  return 'PENDING'
}

function buildPriceRows(rows) {
  const out = []
  for (const row of rows) {
    const trimDescription = toText(get(row, 'Trim Description'))
    const model = toText(get(row, 'MODEL')) || trimDescription.split(/\s+/)[0] || 'UNKNOWN'
    const hyp = toText(get(row, 'HYP'))
    const bankBranch = toText(get(row, 'BANK BRACH', 'BANK BRANCH')) || null
    const insuranceCompany = toText(get(row, 'INSURANCE COMPANY')) || null
    if (trimDescription && model) {
      out.push({
        model,
        trim_description: trimDescription,
        colour: normalizeColour(get(row, 'Colour')) || null,
        hyp: hyp || null,
        bank_name: hyp || null,
        bank_branch: bankBranch,
        ex_showroom_price: toNumber(get(row, 'New Ex-showroom Prices', 'EX SHOWOOM')),
        tcs: toNumber(get(row, 'TCS')),
        statutory_charges: toNumber(get(row, 'Statutory Charges')),
        registration_charges: toNumber(get(row, 'Registration Charges')),
        insurance: toNumber(get(row, 'Insurance')),
        fastag: toNumber(get(row, 'Fastag')),
        accessories_kit: toNumber(get(row, 'Accessories Kit')),
        extended_warranty_4th_year: toNumber(get(row, 'Extended Warranty 4th Year')),
        insurance_company: insuranceCompany,
        metadata: {
          sourceSheet: row.__sheetName,
          sourceRow: row.__rowNumber,
          serialNumber: toText(get(row, 's.no')) || null,
          onRoadPrice: toNumber(get(row, 'On-Road Price')),
        },
      })
      continue
    }
    if (hyp || bankBranch || insuranceCompany) {
      out.push({
        model: hyp || insuranceCompany ? '__LOOKUP_OPTION__' : '__BANK_OPTION__',
        trim_description: `${hyp || insuranceCompany || 'BANK'} ${bankBranch || row.__rowNumber}`.trim(),
        colour: null,
        hyp: hyp || null,
        bank_name: hyp || null,
        bank_branch: bankBranch,
        ex_showroom_price: 0,
        tcs: 0,
        statutory_charges: 0,
        registration_charges: 0,
        insurance: 0,
        fastag: 0,
        accessories_kit: 0,
        extended_warranty_4th_year: 0,
        insurance_company: insuranceCompany,
        metadata: { sourceSheet: row.__sheetName, sourceRow: row.__rowNumber, lookupType: 'option' },
      })
    }
  }
  return out
}

function buildLegacyProforma(row) {
  const entryTime = toDate(get(row, 'Timestamp')) || new Date()
  const proformaDate = toDate(get(row, 'PROFORMA DATE')) || entryTime
  const customerName = toText(get(row, 'CUSTOMER NAME'))
  const mobileNumber = toMobile(get(row, 'MOBILE NO'))
  if (!customerName || !mobileNumber) return null
  const checkedBy = toText(get(row, 'CHECKED BY'))
  const emailSendStatus = toText(get(row, 'EMAIL SEND STATUS'))

  return {
    entry_time: entryTime,
    proforma_date: proformaDate,
    customer_type: 'Customer',
    customer_name: customerName,
    mobile_number: mobileNumber,
    customer_address: toText(get(row, 'ADDRESS')),
    customer_email: toText(get(row, 'Customer Email id')),
    model_name: toText(get(row, 'Vehicle Model')),
    trim_description: toText(get(row, 'Variant')),
    fuel_type: toText(get(row, 'Fuel Type')),
    vehicle_color: toText(get(row, 'Color')),
    bank_name: toText(get(row, 'Bank')),
    bank_branch: toText(get(row, 'BANK BRANCH')) || null,
    vehicle_status: 'UNKNOWN',
    loan_amount: 0,
    insurance_company: null,
    ex_showroom: toNumber(get(row, 'EX SHOWOOM')),
    tcs_value: toNumber(get(row, 'T.C.S.')),
    registration_charges: toNumber(get(row, 'R.T.O')),
    insurance_value: toNumber(get(row, 'Insurance (Approx.)')),
    fastag_value: 0,
    accessories_kit: toNumber(get(row, 'ACCESSORIES COMBO')),
    ext_warranty: toNumber(get(row, 'Warranty')),
    cash_discount: toNumber(get(row, 'CASH DISCOUNT')),
    exchange_value: toNumber(get(row, 'EXCHANGE')),
    booking_amount: toNumber(get(row, 'Booking Amount')),
    govt_employee_discount: toNumber(get(row, 'Govt. Employee (After Complete Documents)*')),
    additional_discount: toNumber(get(row, 'ADDITIONAL DISCOUNT')),
    total_customer_cost: toNumber(get(row, 'TOTAL (To Be Borne By Customer)')),
    grand_total_cost: toNumber(get(row, 'GRAND TOTAL')),
    login_email: toEmail(get(row, 'Email Address')) || 'unknown@import.local',
    consultant: toText(get(row, 'Consultant name')) || toEmail(get(row, 'Email Address')) || 'Unknown',
    location: toText(get(row, 'DEALER LOCATION')) || null,
    emp_code: null,
    approval_status: normalizeStatus(get(row, 'APPROVAL STATUS'), checkedBy, emailSendStatus),
    approved_by: checkedBy && checkedBy.toUpperCase() !== 'NOT APPROVED' ? checkedBy : null,
    checked_by: checkedBy || null,
    email_send_status: emailSendStatus || null,
    link_preview: null,
    finance_status: 'Pending',
    finance_remarks: null,
    finance_updated_time: null,
    add_disc_approval: {},
    import_metadata: {
      sourceSheet: row.__sheetName,
      sourceRow: row.__rowNumber,
      historicalFastagPolicy: 'fastag_value set to 0 because Form Responses 1 has no Fastag column',
    },
  }
}

function dedupeRows(rows) {
  const seen = new Set()
  const unique = []
  for (const row of rows) {
    const key = [
      row.entry_time instanceof Date ? row.entry_time.toISOString() : row.entry_time,
      row.proforma_date instanceof Date ? row.proforma_date.toISOString().slice(0, 10) : row.proforma_date,
      row.mobile_number,
      row.customer_name.toLowerCase(),
      row.grand_total_cost,
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(row)
  }
  return unique
}

function buildProfiles(proformas, mailRows) {
  const map = new Map()
  for (const row of proformas) {
    if (!row.login_email || row.login_email === 'unknown@import.local') continue
    const currentTime = row.entry_time instanceof Date ? row.entry_time : new Date(row.entry_time)
    const existing = map.get(row.login_email)
    if (!existing || currentTime > existing.last_activity_at) {
      map.set(row.login_email, {
        email: row.login_email,
        consultant_name: row.consultant || row.login_email,
        dealer_location: row.location,
        employee_code: row.emp_code,
        status: 'ACTIVE',
        approver: false,
        settings: {},
        last_activity_at: currentTime,
      })
    }
  }
  for (const row of mailRows) {
    const email = toEmail(get(row, 'CC EMAIL IDS'))
    if (!email || !email.includes('@')) continue
    const name = toText(get(row, 'APPROVER NAME')) || email
    const existing = map.get(email)
    map.set(email, {
      email,
      consultant_name: existing?.consultant_name || name,
      dealer_location: existing?.dealer_location || null,
      employee_code: existing?.employee_code || null,
      status: existing?.status || 'ACTIVE',
      approver: true,
      settings: { ...(existing?.settings || {}), mgApproverSource: 'MAIL DETAILS' },
      last_activity_at: existing?.last_activity_at || new Date(),
    })
  }
  return [...map.values()]
}

function summarize(workbook) {
  const priceRows = buildPriceRows(readRows(workbook, 'PRICE DETAILS'))
  const legacy = readRows(workbook, 'Form Responses 1').map(buildLegacyProforma).filter(Boolean)
  const proformas = dedupeRows(legacy)
  const profiles = buildProfiles(proformas, readRows(workbook, 'MAIL DETAILS'))
  return { priceRows, legacy, proformas, profiles }
}

async function ensureSchema(sql) {
  const setupSql = fs.readFileSync(path.resolve(process.cwd(), 'scripts/create-mg-proforma.sql'), 'utf8')
  await sql.unsafe(setupSql)
}

async function insertProfile(sql, row) {
  await sql`
    INSERT INTO mg_user_profiles ${sql(row, 'email', 'consultant_name', 'dealer_location', 'employee_code', 'status', 'approver', 'settings', 'last_activity_at')}
    ON CONFLICT (email) DO UPDATE SET
      consultant_name = COALESCE(NULLIF(EXCLUDED.consultant_name, ''), mg_user_profiles.consultant_name),
      dealer_location = COALESCE(EXCLUDED.dealer_location, mg_user_profiles.dealer_location),
      employee_code = COALESCE(EXCLUDED.employee_code, mg_user_profiles.employee_code),
      status = CASE WHEN mg_user_profiles.status = 'NEW USER' THEN EXCLUDED.status ELSE mg_user_profiles.status END,
      approver = mg_user_profiles.approver OR EXCLUDED.approver,
      settings = mg_user_profiles.settings || EXCLUDED.settings,
      last_activity_at = GREATEST(COALESCE(mg_user_profiles.last_activity_at, EXCLUDED.last_activity_at), EXCLUDED.last_activity_at),
      updated_at = now()
  `
}

async function insertPriceRow(sql, row) {
  const exists = await sql`
    SELECT id FROM mg_price_details
    WHERE lower(model) = lower(${row.model})
      AND lower(trim_description) = lower(${row.trim_description})
      AND COALESCE(lower(colour), '') = COALESCE(lower(${row.colour}), '')
      AND COALESCE(lower(bank_name), '') = COALESCE(lower(${row.bank_name}), '')
      AND COALESCE(lower(bank_branch), '') = COALESCE(lower(${row.bank_branch}), '')
      AND ex_showroom_price = ${row.ex_showroom_price}
    LIMIT 1
  `
  if (exists.length) return false
  await sql`
    INSERT INTO mg_price_details ${sql(row, 'model', 'trim_description', 'colour', 'hyp', 'bank_name', 'bank_branch', 'ex_showroom_price', 'tcs', 'statutory_charges', 'registration_charges', 'insurance', 'fastag', 'accessories_kit', 'extended_warranty_4th_year', 'insurance_company', 'metadata')}
  `
  return true
}

async function insertProforma(sql, row) {
  const exists = await sql`
    SELECT id FROM mg_proformas
    WHERE login_email = ${row.login_email}
      AND mobile_number = ${row.mobile_number}
      AND lower(customer_name) = lower(${row.customer_name})
      AND entry_time = ${row.entry_time}
      AND grand_total_cost = ${row.grand_total_cost}
    LIMIT 1
  `
  if (exists.length) return false
  await sql`
    INSERT INTO mg_proformas ${sql(row, 'entry_time', 'proforma_date', 'customer_type', 'customer_name', 'mobile_number', 'customer_address', 'customer_email', 'model_name', 'trim_description', 'fuel_type', 'vehicle_color', 'bank_name', 'bank_branch', 'vehicle_status', 'loan_amount', 'insurance_company', 'ex_showroom', 'tcs_value', 'registration_charges', 'insurance_value', 'fastag_value', 'accessories_kit', 'ext_warranty', 'cash_discount', 'exchange_value', 'booking_amount', 'govt_employee_discount', 'additional_discount', 'total_customer_cost', 'grand_total_cost', 'login_email', 'consultant', 'location', 'emp_code', 'approval_status', 'approved_by', 'checked_by', 'email_send_status', 'link_preview', 'finance_status', 'finance_remarks', 'finance_updated_time', 'add_disc_approval', 'import_metadata')}
  `
  return true
}

async function bulkInsert(sql, table, rows, columns, chunkSize = 100) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    if (!chunk.length) continue
    await sql`INSERT INTO ${sql(table)} ${sql(chunk, columns)}`
    inserted += chunk.length
  }
  return inserted
}

async function main() {
  if (!fs.existsSync(filePath)) throw new Error(`Workbook not found: ${filePath}`)
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: true })
  const { priceRows, legacy, proformas, profiles } = summarize(workbook)
  const modelNames = Array.from(new Set(priceRows.filter((row) => !row.model.startsWith('__')).map((row) => row.model))).sort()
  const bankNames = Array.from(new Set(priceRows.map((row) => row.bank_name).filter(Boolean))).sort()
  const insuranceCompanies = Array.from(new Set(priceRows.map((row) => row.insurance_company).filter(Boolean))).sort()
  const report = {
    workbook: filePath,
    sheets: workbook.SheetNames,
    priceDetailsRows: priceRows.length,
    historicalResponseRows: legacy.length,
    uniqueProformaRows: proformas.length,
    derivedUserProfiles: profiles.length,
    mgModels: modelNames,
    banks: bankNames,
    insuranceCompanies,
    mode: shouldApply ? 'apply' : 'dry-run',
    setup: shouldSetup,
    replaceImportedRows: shouldReplace,
  }
  console.log(JSON.stringify(report, null, 2))

  if (!shouldApply) {
    console.log('Dry run only. Re-run with --apply to import rows. Use --setup to create/adjust MG Proforma tables first.')
    return
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is missing in .env')

  const sql = postgres(databaseUrl, { ssl: 'require', max: 1, connect_timeout: 20, prepare: false })
  try {
    if (shouldSetup) await ensureSchema(sql)
    const inserted = { profiles: 0, priceDetails: 0, proformas: 0 }
    for (const profile of profiles) {
      await insertProfile(sql, profile)
      inserted.profiles += 1
    }
    if (shouldReplace) {
      await sql`DELETE FROM mg_price_details WHERE metadata->>'sourceSheet' = 'PRICE DETAILS'`
      await sql`DELETE FROM mg_proformas WHERE import_metadata->>'sourceSheet' = 'Form Responses 1'`
      inserted.priceDetails = await bulkInsert(sql, 'mg_price_details', priceRows, [
        'model',
        'trim_description',
        'colour',
        'hyp',
        'bank_name',
        'bank_branch',
        'ex_showroom_price',
        'tcs',
        'statutory_charges',
        'registration_charges',
        'insurance',
        'fastag',
        'accessories_kit',
        'extended_warranty_4th_year',
        'insurance_company',
        'metadata',
      ])
      inserted.proformas = await bulkInsert(sql, 'mg_proformas', proformas, [
        'entry_time',
        'proforma_date',
        'customer_type',
        'customer_name',
        'mobile_number',
        'customer_address',
        'customer_email',
        'model_name',
        'trim_description',
        'fuel_type',
        'vehicle_color',
        'bank_name',
        'bank_branch',
        'vehicle_status',
        'loan_amount',
        'insurance_company',
        'ex_showroom',
        'tcs_value',
        'registration_charges',
        'insurance_value',
        'fastag_value',
        'accessories_kit',
        'ext_warranty',
        'cash_discount',
        'exchange_value',
        'booking_amount',
        'govt_employee_discount',
        'additional_discount',
        'total_customer_cost',
        'grand_total_cost',
        'login_email',
        'consultant',
        'location',
        'emp_code',
        'approval_status',
        'approved_by',
        'checked_by',
        'email_send_status',
        'link_preview',
        'finance_status',
        'finance_remarks',
        'finance_updated_time',
        'add_disc_approval',
        'import_metadata',
      ])
    } else {
      for (const row of priceRows) {
        if (await insertPriceRow(sql, row)) inserted.priceDetails += 1
      }
      for (const row of proformas) {
        if (await insertProforma(sql, row)) inserted.proformas += 1
      }
    }
    const totals = await sql`
      SELECT
        (SELECT count(*)::int FROM mg_user_profiles) AS user_profiles,
        (SELECT count(*)::int FROM mg_price_details) AS price_details,
        (SELECT count(*)::int FROM mg_proformas) AS proformas
    `
    console.log(JSON.stringify({ inserted, databaseTotals: totals[0] }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
