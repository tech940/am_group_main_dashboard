import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
import { ScrapTransaction } from '@/lib/scrap-erp/types'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

const DISTRIBUTION_START_DATE = '2026-07-01'

export const dynamic = 'force-dynamic'

function mapDbRowToTransaction(row: any): ScrapTransaction {
  const soldDate = row.sold_date ? String(row.sold_date).slice(0, 10) : ''
  const timestamp = row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString()
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  const accountsReceivedAt = row.accounts_received_at ? new Date(row.accounts_received_at).toISOString() : undefined

  const dateStr = (soldDate || timestamp || createdAt).slice(0, 10)
  const isDistributed = dateStr >= DISTRIBUTION_START_DATE ? Boolean(row.is_distributed) : false

  const rawStatus = String(row.status || 'COMPLETED').toUpperCase()
  const status: 'COMPLETED' | 'FLAGGED' | 'DRAFT' =
    rawStatus === 'FLAGGED' ? 'FLAGGED' : rawStatus === 'DRAFT' ? 'DRAFT' : 'COMPLETED'

  return {
    id: String(row.id),
    transactionNumber: String(row.transaction_number || ''),
    timestamp,
    groupId: row.group_id ? String(row.group_id) : 'grp-1',
    groupName: String(row.group_name || 'JAM'),
    locationId: row.location_id ? String(row.location_id) : 'loc-1',
    locationName: String(row.location_name || ''),
    departmentId: row.department_id ? String(row.department_id) : 'dept-1',
    departmentName: String(row.department_name || ''),
    scrapTypeId: row.scrap_type_id ? String(row.scrap_type_id) : 'type-1',
    scrapTypeName: String(row.scrap_type_name || ''),
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
    paymentModeId: String(row.payment_mode_id || 'pm-1'),
    paymentModeName: String(row.payment_mode_name || ''),
    paymentHandoverToId: String(row.payment_handover_to_id || 'ho-1'),
    paymentHandoverToName: String(row.payment_handover_to_name || ''),
    remarks: row.remarks ? String(row.remarks) : '',
    status,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
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
  logToFile(`ENV DATABASE_URL: ${process.env.DATABASE_URL}`)
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    logToFile('GET /api/scrap-erp: Unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  logToFile(`GET /api/scrap-erp: User authenticated. Email: ${appUser.email}, Role: ${appUser.role}`)
  if (!canAccessScrapErp(appUser.role)) {
    logToFile(`GET /api/scrap-erp: Forbidden. Role ${appUser.role} does not have access`)
    return NextResponse.json({ error: 'You do not have access to Scrap ERP.' }, { status: 403 })
  }
  try {
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

    logToFile(`GET /api/scrap-erp success. Total mapped: ${transactions.length}`)
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
    const body = await request.json()

    const weightQty = Number(body.weightQty || 0)
    const ratePerUnit = Number(body.ratePerUnit || 0)
    const calculatedTotal = Math.round(weightQty * ratePerUnit * 100) / 100
    const amountReceived = Number(body.amountReceived !== undefined ? body.amountReceived : calculatedTotal)
    const outstandingAmount = Math.max(0, calculatedTotal - amountReceived)

    // Compute next transaction number SCRAP-2026-0XXX
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
    const locationName = body.locationName || 'Dealership Location'
    const departmentName = body.departmentName || 'SERVICE'
    const scrapTypeName = body.scrapTypeName || 'PLASTIC'
    const unit = body.unit || 'Kg'
    const description = body.description || 'Scrap Disposal Entry'
    const soldByName = body.soldByName || 'Staff Member'
    const soldTo = body.soldTo || 'Local Vendor'
    const paymentModeName = body.paymentModeName || 'CASH'
    const paymentHandoverToName = body.paymentHandoverToName || 'Accounts Team'
    const remarks = body.remarks || ''

    const inserted = await db.execute(sql.raw(`
      INSERT INTO scrap_transactions (
        transaction_number, timestamp, group_name, location_name, department_name,
        scrap_type_name, unit, description, weight_qty, rate_per_unit,
        calculated_total, amount_received, outstanding_amount, sold_by_name,
        sold_to, sold_date, payment_mode_name, payment_handover_to_name,
        remarks, status, is_distributed, sent_to_accounts, created_at, updated_at
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
        '${soldDate}',
        '${paymentModeName.replace(/'/g, "''")}',
        '${paymentHandoverToName.replace(/'/g, "''")}',
        '${remarks.replace(/'/g, "''")}',
        '${status}',
        FALSE,
        FALSE,
        NOW(),
        NOW()
      )
      RETURNING *
    `))

    const newTx = mapDbRowToTransaction(inserted[0])

    return NextResponse.json({
      success: true,
      transaction: newTx,
      message: 'Scrap transaction recorded successfully',
    })
  } catch (error) {
    console.error('Error in POST /api/scrap-erp:', error)
    return NextResponse.json({ error: 'Failed to create scrap transaction' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { id, transactionNumber } = body

    if (!id && !transactionNumber) {
      return NextResponse.json({ error: 'Transaction ID or number is required' }, { status: 400 })
    }

    const whereClause = id
      ? `id = '${String(id).replace(/'/g, "''")}'`
      : `transaction_number = '${String(transactionNumber).replace(/'/g, "''")}'`

    const existingRes = await db.execute(sql.raw(`SELECT * FROM scrap_transactions WHERE ${whereClause} LIMIT 1`))
    if (existingRes.length === 0) {
      return NextResponse.json({ error: 'Transaction record not found' }, { status: 404 })
    }

    const existing = existingRes[0]
    const existingDateStr = (existing.sold_date || existing.timestamp || existing.created_at || '').toString().slice(0, 10)
    const isPreJuly = existingDateStr < DISTRIBUTION_START_DATE

    const weightQty = body.weightQty !== undefined ? Number(body.weightQty) : Number(existing.weight_qty || 0)
    const ratePerUnit = body.ratePerUnit !== undefined ? Number(body.ratePerUnit) : Number(existing.rate_per_unit || 0)
    const calculatedTotal = Math.round(weightQty * ratePerUnit * 100) / 100
    const amountReceived = body.amountReceived !== undefined ? Number(body.amountReceived) : Math.round(Number(existing.amount_received || 0) * 100) / 100
    const outstandingAmount = Math.max(0, calculatedTotal - amountReceived)
    const status = outstandingAmount >= 1 ? 'FLAGGED' : 'COMPLETED'

    const isDistributed = isPreJuly ? false : (body.isDistributed !== undefined ? Boolean(body.isDistributed) : Boolean(existing.is_distributed))
    const sentToAccounts = body.sentToAccounts !== undefined ? Boolean(body.sentToAccounts) : Boolean(existing.sent_to_accounts)
    const paymentHandoverToName = body.paymentHandoverToName !== undefined ? String(body.paymentHandoverToName) : String(existing.payment_handover_to_name || '')
    const accountsNote = body.accountsNote !== undefined ? String(body.accountsNote) : String(existing.accounts_note || '')

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
