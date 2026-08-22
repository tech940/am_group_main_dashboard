import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { ScrapTransaction, ScrapAttachment, normalizeScrapLocationName } from '@/lib/scrap-erp/types'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

const DISTRIBUTION_START_DATE = '2026-07-01'

export const dynamic = 'force-dynamic'

/**
 * `sold_date` is a Postgres DATE, and the driver hands it back as a **JS Date object**, not a
 * string. `String(dateObj).slice(0, 10)` therefore produced "Thu Jul 30" — a weekday with no year —
 * on every single row, which silently broke three things at once:
 *   • the grid's Date column and the CSV Date column displayed "Thu Jul 30"
 *   • every date-range filter returned ZERO rows, because "Thu Jul 30" <= "2026-07-31" is false
 *   • every July-window test passed, because "Thu Jul 30" >= "2026-07-01" is true ('T' > '2') —
 *     so all 265 records counted as in the distribution window instead of the real 49.
 *
 * toISOString() is the correct read (the sibling timestamp fields on the next lines already use it).
 * The String() branch is kept only for the case where the driver is configured to return text.
 */
function toIsoDate(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

let attachmentsColumnChecked = false
async function ensureScrapAttachmentsColumn() {
  if (attachmentsColumnChecked) return
  try {
    await db.execute(sql.raw(`
      ALTER TABLE scrap_transactions ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    `))
    attachmentsColumnChecked = true
  } catch (e) {
    console.error('Failed to ensure attachments column:', e)
  }
}

function parseAttachments(val: unknown): ScrapAttachment[] {
  if (Array.isArray(val)) {
    return val as ScrapAttachment[]
  }
  if (typeof val === 'string' && val.trim()) {
    try {
      const parsed = JSON.parse(val)
      if (Array.isArray(parsed)) return parsed as ScrapAttachment[]
    } catch {}
  }
  return []
}

function mapDbRowToTransaction(row: Record<string, unknown>): ScrapTransaction {
  const soldDate = toIsoDate(row.sold_date)
  const timestamp = row.timestamp ? new Date(String(row.timestamp)).toISOString() : new Date().toISOString()
  const createdAt = row.created_at ? new Date(String(row.created_at)).toISOString() : new Date().toISOString()
  const updatedAt = row.updated_at ? new Date(String(row.updated_at)).toISOString() : createdAt
  const accountsReceivedAt = row.accounts_received_at ? new Date(String(row.accounts_received_at)).toISOString() : undefined

  const dateStr = (soldDate || timestamp || createdAt).slice(0, 10)
  const isDistributed = dateStr >= DISTRIBUTION_START_DATE ? Boolean(row.is_distributed) : false

  const rawStatus = String(row.status || 'COMPLETED').toUpperCase()
  const status: 'COMPLETED' | 'FLAGGED' | 'DRAFT' =
    rawStatus === 'FLAGGED' ? 'FLAGGED' : rawStatus === 'DRAFT' ? 'DRAFT' : 'COMPLETED'

  const txnNum = String(row.transaction_number || '')
  const scrapTypeName = String(row.scrap_type_name || '')

  return {
    id: String(row.id),
    transactionNumber: txnNum,
    timestamp,
    groupId: row.group_id ? String(row.group_id) : undefined,
    groupName: row.group_name ? String(row.group_name) : 'JAM',
    locationId: String(row.location_id || ''),
    locationName: normalizeScrapLocationName(String(row.location_name || '')),
    departmentId: String(row.department_id || ''),
    departmentName: String(row.department_name || ''),
    scrapTypeId: String(row.scrap_type_id || ''),
    scrapTypeName,
    unit: String(row.unit || 'Kg'),
    description: String(row.description || ''),
    weightQty: Number(row.weight_qty || 0),
    ratePerUnit: Number(row.rate_per_unit || 0),
    calculatedTotal: Number(row.calculated_total || 0),
    amountReceived: Number(row.amount_received || 0),
    outstandingAmount: Number(row.outstanding_amount || 0),
    soldById: String(row.sold_by_id || 'emp-1'),
    soldByName: String(row.sold_by_name || ''),
    soldTo: String(row.sold_to || ''),
    soldDate,
    paymentModeId: String(row.payment_mode_id || ''),
    paymentModeName: String(row.payment_mode_name || ''),
    paymentHandoverToId: String(row.payment_handover_to_id || ''),
    paymentHandoverToName: String(row.payment_handover_to_name || ''),
    remarks: row.remarks ? String(row.remarks) : '',
    status,
    attachments: parseAttachments(row.attachments),
    isDistributed,
    sentToAccounts: Boolean(row.sent_to_accounts),
    accountsReceivedAt,
    accountsNote: row.accounts_note ? String(row.accounts_note) : undefined,
    createdAt,
    updatedAt,
  }
}

import fs from 'fs'

function logToFile(msg: string) {
  try {
    fs.appendFileSync('c:\\Users\\sahil\\Downloads\\am_group_main_dashboard\\scrap-api-log.txt', `[${new Date().toISOString()}] ${msg}\n`)
  } catch (e) {}
}

export async function GET(request: Request) {
  logToFile('GET /api/scrap-erp called')
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canAccessScrapErp(appUser.role) && !(await isPermissionExplicitlyAllowed(appUser, 'scrap_erp.view'))) {
    return NextResponse.json({ error: 'You do not have access to Scrap ERP.' }, { status: 403 })
  }
  try {
    await ensureScrapAttachmentsColumn()
    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') || '').toLowerCase().trim()
    const location = searchParams.get('location')
    const department = searchParams.get('department')
    const scrapType = searchParams.get('scrapType')

    const dbRows = await db.execute(sql.raw(`
      SELECT *
      FROM scrap_transactions
      ORDER BY created_at DESC, timestamp DESC
    `))

    let transactions = (dbRows as any[]).map(mapDbRowToTransaction)

    if (search) {
      transactions = transactions.filter(
        (tx) =>
          tx.transactionNumber.toLowerCase().includes(search) ||
          tx.locationName.toLowerCase().includes(search) ||
          tx.departmentName.toLowerCase().includes(search) ||
          tx.scrapTypeName.toLowerCase().includes(search) ||
          tx.soldTo.toLowerCase().includes(search) ||
          tx.soldByName.toLowerCase().includes(search) ||
          tx.description.toLowerCase().includes(search) ||
          (tx.remarks && tx.remarks.toLowerCase().includes(search))
      )
    }

    if (location && location !== 'all') {
      transactions = transactions.filter((tx) => tx.locationId === location || tx.locationName === location)
    }
    if (department && department !== 'all') {
      transactions = transactions.filter((tx) => tx.departmentId === department || tx.departmentName === department)
    }
    if (scrapType && scrapType !== 'all') {
      transactions = transactions.filter((tx) => tx.scrapTypeId === scrapType || tx.scrapTypeName === scrapType)
    }

    return NextResponse.json({
      success: true,
      transactions,
      totalCount: transactions.length,
    })
  } catch (error: any) {
    logToFile(`GET /api/scrap-erp exception: ${String(error.message || error)}`)
    console.error('Error in GET /api/scrap-erp:', error)
    return NextResponse.json({ error: 'Failed to fetch scrap transactions' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessScrapErp(appUser.role) && !(await isPermissionExplicitlyAllowed(appUser, 'scrap_erp.edit'))) {
      return NextResponse.json({ error: 'You do not have permission to create scrap records.' }, { status: 403 })
    }

    await ensureScrapAttachmentsColumn()
    const body = await request.json()

    const weightQty = Number(body.weightQty || 0)
    const ratePerUnit = Number(body.ratePerUnit || 0)
    const calculatedTotal = Math.round(weightQty * ratePerUnit * 100) / 100
    const amountReceived = Number(body.amountReceived !== undefined ? body.amountReceived : calculatedTotal)
    const outstandingAmount = Math.max(0, calculatedTotal - amountReceived)

    const maxNumRes = await db.execute(sql.raw(`
      SELECT transaction_number FROM scrap_transactions 
      WHERE transaction_number LIKE 'SCRAP-2026-%' 
      ORDER BY transaction_number DESC LIMIT 1
    `))
    let nextSeq = 236
    if (maxNumRes.length > 0) {
      const match = String(maxNumRes[0].transaction_number).match(/SCRAP-2026-(\d+)/)
      if (match) {
        nextSeq = Number(match[1]) + 1
      }
    }
    const nextNumber = `SCRAP-2026-${String(nextSeq).padStart(4, '0')}`

    const status = outstandingAmount >= 1 ? 'FLAGGED' : 'COMPLETED'
    const soldDate = body.soldDate || new Date().toISOString().split('T')[0]
    const timestamp = body.timestamp || new Date().toISOString()
    const groupName = body.groupName || 'JAM'
    const locationName = normalizeScrapLocationName(body.locationName || 'Dealership Location')
    const departmentName = body.departmentName || 'SERVICE'
    const scrapTypeName = body.scrapTypeName || 'PLASTIC'
    const unit = body.unit || 'Kg'
    const description = body.description || 'Scrap Disposal Entry'
    const soldByName = body.soldByName || 'Staff Member'
    const soldTo = body.soldTo || 'Local Vendor'
    const paymentModeName = body.paymentModeName || 'CASH'
    const paymentHandoverToName = body.paymentHandoverToName || 'Accounts Team'
    const remarks = body.remarks || ''
    const attachmentsJson = JSON.stringify(Array.isArray(body.attachments) ? body.attachments : []).replace(/'/g, "''")

    const inserted = await db.execute(sql.raw(`
      INSERT INTO scrap_transactions (
        transaction_number, timestamp, group_name, location_name, department_name,
        scrap_type_name, unit, description, weight_qty, rate_per_unit,
        calculated_total, amount_received, outstanding_amount, sold_by_name,
        sold_to, sold_date, payment_mode_name, payment_handover_to_name,
        remarks, status, is_distributed, sent_to_accounts, attachments, created_at, updated_at
      ) VALUES (
        '${nextNumber}',
        '${timestamp}',
        '${groupName.replace(/'/g, "''")}',
        '${locationName.replace(/'/g, "''")}',
        '${departmentName.replace(/'/g, "''")}',
        '${scrapTypeName.replace(/'/g, "''")}',
        '${unit.replace(/'/g, "''")}',
        '${description.replace(/'/g, "''")}',
        ${weightQty},
        ${ratePerUnit},
        ${calculatedTotal},
        ${amountReceived},
        ${outstandingAmount},
        '${soldByName.replace(/'/g, "''")}',
        '${soldTo.replace(/'/g, "''")}',
        ${soldDate ? `'${soldDate}'` : 'NULL'},
        '${paymentModeName.replace(/'/g, "''")}',
        '${paymentHandoverToName.replace(/'/g, "''")}',
        '${remarks.replace(/'/g, "''")}',
        '${status}',
        false,
        false,
        '${attachmentsJson}'::jsonb,
        NOW(),
        NOW()
      )
      RETURNING *
    `))

    const insertedRow = (inserted as any[])[0]
    return NextResponse.json({
      success: true,
      transaction: mapDbRowToTransaction(insertedRow),
      message: 'Scrap transaction created successfully',
    })
  } catch (error: any) {
    logToFile(`POST /api/scrap-erp exception: ${String(error.message || error)}`)
    console.error('Error in POST /api/scrap-erp:', error)
    return NextResponse.json({ error: 'Failed to create scrap transaction' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  logToFile('PUT /api/scrap-erp called')
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canAccessScrapErp(appUser.role) && !(await isPermissionExplicitlyAllowed(appUser, 'scrap_erp.edit'))) {
    return NextResponse.json({ error: 'You do not have permission to edit Scrap ERP entries.' }, { status: 403 })
  }
  try {
    await ensureScrapAttachmentsColumn()
    const body = await request.json()
    if (!body.id && !body.transactionNumber) {
      return NextResponse.json({ error: 'Transaction ID or number required' }, { status: 400 })
    }

    const whereClause = body.id
      ? `id = '${String(body.id).replace(/'/g, "''")}'`
      : `transaction_number = '${String(body.transactionNumber).replace(/'/g, "''")}'`

    const existingRes = await db.execute(sql.raw(`SELECT * FROM scrap_transactions WHERE ${whereClause} LIMIT 1`))
    const existing = (existingRes as any[])[0]
    if (!existing) {
      return NextResponse.json({ error: 'Transaction record not found' }, { status: 404 })
    }
    const existingDateStr = toIsoDate(existing.sold_date) || toIsoDate(existing.timestamp) || toIsoDate(existing.created_at)
    const isPreJuly = Boolean(existingDateStr) && existingDateStr < DISTRIBUTION_START_DATE

    const weightQty = body.weightQty !== undefined ? Number(body.weightQty) : Number(existing.weight_qty || 0)
    const ratePerUnit = body.ratePerUnit !== undefined ? Number(body.ratePerUnit) : Number(existing.rate_per_unit || 0)

    /**
     * ⚠️ THE TOTAL IS AUTHORITATIVE INPUT, NOT A DERIVED VALUE.
     *
     * This used to be an unconditional `round(weightQty * ratePerUnit, 2)`, which DESTROYED money:
     * 12 live rows carry a total stated directly on the source register with no qty or rate
     * (Rs 92,994 in all), so any save recomputed them to ZERO while amount_received kept its real
     * value. It was silent — outstanding clamps at 0 and status stayed COMPLETED.
     *
     * Worse, it did not need an edit form: the Distribution tab's one-click "mark distributed" PUTs
     * only { id, isDistributed }, the qty/rate fell back to the existing zeros, and the total was
     * wiped anyway.
     *
     * Order of precedence: an explicit total from the client, else qty x rate when BOTH are present,
     * else keep whatever is already stored. The last branch is what protects those 12 rows.
     */
    const derivedTotal = Math.round(weightQty * ratePerUnit * 100) / 100
    const calculatedTotal = body.calculatedTotal !== undefined
      ? Math.round(Number(body.calculatedTotal) * 100) / 100
      : (weightQty > 0 && ratePerUnit > 0)
        ? derivedTotal
        : Math.round(Number(existing.calculated_total || 0) * 100) / 100

    const amountReceived = body.amountReceived !== undefined ? Number(body.amountReceived) : Math.round(Number(existing.amount_received || 0) * 100) / 100
    // Rounded, unlike before: the raw subtraction produced IEEE residue such as 0.0999999999985.
    const outstandingAmount = Math.max(0, Math.round((calculatedTotal - amountReceived) * 100) / 100)
    const status = outstandingAmount >= 1 ? 'FLAGGED' : 'COMPLETED'

    const isDistributed = isPreJuly ? false : (body.isDistributed !== undefined ? Boolean(body.isDistributed) : Boolean(existing.is_distributed))
    const sentToAccounts = body.sentToAccounts !== undefined ? Boolean(body.sentToAccounts) : Boolean(existing.sent_to_accounts)
    const paymentHandoverToName = body.paymentHandoverToName !== undefined ? String(body.paymentHandoverToName) : String(existing.payment_handover_to_name || '')
    const accountsNote = body.accountsNote !== undefined ? String(body.accountsNote) : String(existing.accounts_note || '')

    /**
     * The SET list used to cover ONLY the money + workflow columns, so every descriptive edit was
     * silently discarded: change a vendor, get "updated successfully", see it in the UI, and find
     * the old value again on the next refresh. sold_to, location_name, department_name,
     * scrap_type_name, description, remarks, group_name, unit, payment_mode_name and sold_date were
     * all sent by the entry form and none were written.
     *
     * Each is applied ONLY when the request actually carries it, so a partial PUT (the Distribution
     * tab sends just { id, isDistributed }) still cannot clobber a field it never mentioned.
     */
    const q = (v: unknown) => `'${String(v ?? '').replace(/'/g, "''")}'`
    const textUpdates: string[] = []
    const TEXT_FIELDS: Array<[string, string]> = [
      ['groupName', 'group_name'],
      ['locationName', 'location_name'],
      ['departmentName', 'department_name'],
      ['scrapTypeName', 'scrap_type_name'],
      ['unit', 'unit'],
      ['description', 'description'],
      ['soldTo', 'sold_to'],
      ['soldByName', 'sold_by_name'],
      ['paymentModeName', 'payment_mode_name'],
      ['remarks', 'remarks'],
    ]
    for (const [bodyKey, column] of TEXT_FIELDS) {
      if (body[bodyKey] !== undefined) textUpdates.push(`${column} = ${q(body[bodyKey])}`)
    }
    if (body.soldDate !== undefined) {
      const d = toIsoDate(body.soldDate) || String(body.soldDate).slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) textUpdates.push(`sold_date = ${q(d)}`)
    }

    const attachmentsUpdateSql = body.attachments !== undefined
      ? `attachments = '${JSON.stringify(Array.isArray(body.attachments) ? body.attachments : []).replace(/'/g, "''")}'::jsonb,`
      : ''

    const updatedRes = await db.execute(sql.raw(`
      UPDATE scrap_transactions
      SET
        weight_qty = ${weightQty},
        rate_per_unit = ${ratePerUnit},
        calculated_total = ${calculatedTotal},
        amount_received = ${amountReceived},
        outstanding_amount = ${outstandingAmount},
        status = '${status}',
        is_distributed = ${isDistributed ? 'TRUE' : 'FALSE'},
        sent_to_accounts = ${sentToAccounts ? 'TRUE' : 'FALSE'},
        payment_handover_to_name = '${paymentHandoverToName.replace(/'/g, "''")}',
        accounts_note = '${accountsNote.replace(/'/g, "''")}',
        ${attachmentsUpdateSql}
        ${textUpdates.length ? `${textUpdates.join(',\n        ')},` : ''}
        ${body.accountsReceivedAt ? `accounts_received_at = '${new Date(body.accountsReceivedAt).toISOString()}',` : ''}
        updated_at = NOW()
      WHERE ${whereClause}
      RETURNING *
    `))

    const updatedTx = mapDbRowToTransaction(updatedRes[0])

    return NextResponse.json({
      success: true,
      transaction: updatedTx,
      message: 'Scrap transaction updated successfully',
    })
  } catch (error) {
    console.error('Error in PUT /api/scrap-erp:', error)
    return NextResponse.json({ error: 'Failed to update scrap transaction' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessScrapErp(appUser.role) && !(await isPermissionExplicitlyAllowed(appUser, 'scrap_erp.edit'))) {
      return NextResponse.json({ error: 'You do not have permission to delete scrap records.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const transactionNumber = searchParams.get('transactionNumber')

    if (!id && !transactionNumber) {
      return NextResponse.json({ error: 'Missing id or transactionNumber' }, { status: 400 })
    }

    const whereClause = id
      ? `id = '${id}'`
      : `transaction_number ILIKE '%${transactionNumber?.replace(/'/g, "''")}%'`

    const deleted = await db.execute(sql.raw(`
      DELETE FROM scrap_transactions
      WHERE ${whereClause}
      RETURNING id, transaction_number
    `))

    if ((deleted as any[]).length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: `Scrap record ${(deleted as any[])[0].transaction_number} deleted successfully`,
    })
  } catch (error) {
    console.error('Error in DELETE /api/scrap-erp:', error)
    return NextResponse.json({ error: 'Failed to delete scrap transaction' }, { status: 500 })
  }
}
