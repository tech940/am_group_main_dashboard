/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const postgres = require('postgres')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const DEFAULT_FILE = 'C:\\Users\\HP\\Downloads\\KIA PROFORMA (Responses) - PRICE DETAILS.csv'

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const filePath = path.resolve(argValue('--file', DEFAULT_FILE))
const shouldApply = process.argv.includes('--apply')
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL

function cleanHeader(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/@1%/g, '')
    .replace(/@9%/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toText(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  const text = String(value).trim()
  if (!text || /^#+$/.test(text)) return fallback
  return text
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value).replace(/₹|rs\.?|,/gi, '').replace(/[^0-9.-]/g, '').trim()
  if (!text || text === '-' || /^#+$/.test(text)) return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeKey(value) {
  return toText(value).toLowerCase().replace(/\s+/g, ' ').trim()
}

function get(row, ...headers) {
  for (const header of headers) {
    const key = cleanHeader(header)
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
  }
  return null
}

function readCsvRows(file) {
  const workbook = XLSX.readFile(file, { raw: false })
  const sheetName = workbook.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null })
  return rows.map((row, index) => {
    const normalized = { __rowNumber: index + 2 }
    for (const [key, value] of Object.entries(row)) {
      normalized[cleanHeader(key)] = value
    }
    return normalized
  })
}

function buildPriceRows(rows) {
  const seen = new Set()
  const out = []
  const skipped = []
  const addRow = (keyParts, payload, sourceRow) => {
    const key = keyParts.map(normalizeKey).join('|')
    if (seen.has(key)) {
      skipped.push({ row: sourceRow, reason: 'Duplicate row in CSV' })
      return
    }
    seen.add(key)
    out.push(payload)
  }
  for (const row of rows) {
    const trimDescription = toText(get(row, 'Trim Description'))
    const model = toText(get(row, 'MODEL')) || trimDescription.split(/\s+/)[0] || ''
    const bankName = toText(get(row, 'HYP'))
    const bankBranch = toText(get(row, 'BANK BRACH', 'BANK BRANCH'))
    const insuranceCompany = toText(get(row, 'INSURANCE COMPANY'))

    if (!trimDescription || !model) {
      if (bankName || bankBranch) {
        addRow(
          ['bank_branch', bankName, bankBranch],
          {
            model: '__BANK_OPTION__',
            trim_description: `${bankName || 'BANK'} ${bankBranch || row.__rowNumber}`.trim(),
            hyp: bankName || null,
            bank_name: bankName || null,
            bank_branch: bankBranch || null,
            ex_showroom_price: 0,
            tcs: 0,
            registration_charges: 0,
            statutory_charges: 0,
            insurance: 0,
            fastag: 0,
            accessories_kit: 0,
            extended_warranty_4th_year: 0,
            insurance_company: null,
            metadata: {
              sourceSheet: 'PRICE DETAILS',
              sourceFile: path.basename(filePath),
              sourceRow: row.__rowNumber,
              lookupType: 'bank_branch',
              importedAt: new Date().toISOString(),
            },
          },
          row.__rowNumber
        )
      } else if (insuranceCompany) {
        addRow(
          ['insurance_company', insuranceCompany],
          {
            model: '__INSURANCE_OPTION__',
            trim_description: insuranceCompany,
            hyp: null,
            bank_name: null,
            bank_branch: null,
            ex_showroom_price: 0,
            tcs: 0,
            registration_charges: 0,
            statutory_charges: 0,
            insurance: 0,
            fastag: 0,
            accessories_kit: 0,
            extended_warranty_4th_year: 0,
            insurance_company: insuranceCompany,
            metadata: {
              sourceSheet: 'PRICE DETAILS',
              sourceFile: path.basename(filePath),
              sourceRow: row.__rowNumber,
              lookupType: 'insurance_company',
              importedAt: new Date().toISOString(),
            },
          },
          row.__rowNumber
        )
      } else {
        skipped.push({ row: row.__rowNumber, reason: 'Missing model or trim' })
      }
      continue
    }

    addRow(
      ['price', model, trimDescription, bankName, bankBranch, insuranceCompany],
      {
        model,
        trim_description: trimDescription,
        hyp: bankName || null,
        bank_name: bankName || null,
        bank_branch: bankBranch || null,
        ex_showroom_price: toNumber(get(row, 'New Ex-showroom Prices')),
        tcs: toNumber(get(row, 'TCS')),
        registration_charges: toNumber(get(row, 'Registration Charges')),
        statutory_charges: toNumber(get(row, 'Statutory Charges')),
        insurance: toNumber(get(row, 'Insurance')),
        fastag: toNumber(get(row, 'Fastag')),
        accessories_kit: toNumber(get(row, 'Accessories Kit')),
        extended_warranty_4th_year: toNumber(get(row, 'Extended Warranty 4th Year')),
        insurance_company: insuranceCompany || null,
        metadata: {
          sourceSheet: 'PRICE DETAILS',
          sourceFile: path.basename(filePath),
          sourceRow: row.__rowNumber,
          lookupType: 'price',
          serialNumber: toText(get(row, 's.no')) || null,
          colour: toText(get(row, 'Colour')) || null,
          onRoadPrice: toNumber(get(row, 'On-Road Price')),
          myConveniencePlus: toNumber(get(row, 'My Convenience Plus')),
          importedAt: new Date().toISOString(),
        },
      },
      row.__rowNumber
    )
  }
  return { rows: out, skipped }
}

async function findExisting(sql, row) {
  return sql`
    SELECT id
    FROM kia_price_details
    WHERE lower(trim(model)) = ${normalizeKey(row.model)}
      AND lower(trim(trim_description)) = ${normalizeKey(row.trim_description)}
      AND lower(trim(coalesce(bank_name, ''))) = ${normalizeKey(row.bank_name)}
      AND lower(trim(coalesce(bank_branch, ''))) = ${normalizeKey(row.bank_branch)}
      AND lower(trim(coalesce(insurance_company, ''))) = ${normalizeKey(row.insurance_company)}
    ORDER BY created_at ASC, id ASC
  `
}

async function updatePriceRow(sql, id, row) {
  await sql`
    UPDATE kia_price_details
    SET model = ${row.model},
        trim_description = ${row.trim_description},
        hyp = ${row.hyp},
        bank_name = ${row.bank_name},
        bank_branch = ${row.bank_branch},
        ex_showroom_price = ${row.ex_showroom_price},
        tcs = ${row.tcs},
        registration_charges = ${row.registration_charges},
        statutory_charges = ${row.statutory_charges},
        insurance = ${row.insurance},
        fastag = ${row.fastag},
        accessories_kit = ${row.accessories_kit},
        extended_warranty_4th_year = ${row.extended_warranty_4th_year},
        insurance_company = ${row.insurance_company},
        metadata = ${sql.json(row.metadata)},
        updated_at = now()
    WHERE id = ${id}
  `
}

async function insertPriceRow(sql, row) {
  await sql`
    INSERT INTO kia_price_details (
      model,
      trim_description,
      hyp,
      bank_name,
      bank_branch,
      ex_showroom_price,
      tcs,
      registration_charges,
      statutory_charges,
      insurance,
      fastag,
      accessories_kit,
      extended_warranty_4th_year,
      insurance_company,
      metadata
    )
    VALUES (
      ${row.model},
      ${row.trim_description},
      ${row.hyp},
      ${row.bank_name},
      ${row.bank_branch},
      ${row.ex_showroom_price},
      ${row.tcs},
      ${row.registration_charges},
      ${row.statutory_charges},
      ${row.insurance},
      ${row.fastag},
      ${row.accessories_kit},
      ${row.extended_warranty_4th_year},
      ${row.insurance_company},
      ${sql.json(row.metadata)}
    )
  `
}

async function main() {
  if (!fs.existsSync(filePath)) throw new Error(`CSV file not found: ${filePath}`)
  const { rows, skipped } = buildPriceRows(readCsvRows(filePath))
  console.log(`Read ${rows.length + skipped.length} CSV rows. Valid: ${rows.length}. CSV skipped: ${skipped.length}.`)

  if (!shouldApply) {
    console.log('Dry run only. Add --apply to update kia_price_details.')
    console.log(JSON.stringify({ valid: rows.length, skipped }, null, 2))
    return
  }
  if (!databaseUrl) throw new Error('DATABASE_URL / POSTGRES_URL is not configured.')

  const sql = postgres(databaseUrl, { max: 1 })
  const result = { inserted: 0, updated: 0, skipped: skipped.length, deduped: 0 }
  try {
    await sql`ALTER TABLE kia_price_details ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'`
    await sql.begin(async (tx) => {
      for (const row of rows) {
        const matches = await findExisting(tx, row)
        if (matches.length > 0) {
          await updatePriceRow(tx, matches[0].id, row)
          result.updated += 1
          if (matches.length > 1) {
            const duplicateIds = matches.slice(1).map((match) => match.id)
            await tx`DELETE FROM kia_price_details WHERE id IN ${tx(duplicateIds)}`
            result.deduped += duplicateIds.length
          }
        } else {
          await insertPriceRow(tx, row)
          result.inserted += 1
        }
      }
    })
  } finally {
    await sql.end()
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
