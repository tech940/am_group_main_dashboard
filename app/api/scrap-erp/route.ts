import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
import { INITIAL_SCRAP_TRANSACTIONS } from '@/lib/scrap-erp/mock-data'
import { ScrapTransaction } from '@/lib/scrap-erp/types'

// In-memory global store initialized with seed transactions
// Distribution is only valid from 1 July 2026 onwards — strip any stale isDistributed from earlier records.
const DISTRIBUTION_START_DATE = '2026-07-01'
let globalTransactions: ScrapTransaction[] = INITIAL_SCRAP_TRANSACTIONS.map((t) => {
  const dateStr = (t.soldDate || t.timestamp || t.createdAt || '').slice(0, 10)
  if (dateStr < DISTRIBUTION_START_DATE && t.isDistributed) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isDistributed, distributedAt, distributedBy, ...rest } = t as ScrapTransaction & { isDistributed?: boolean; distributedAt?: string; distributedBy?: string }
    return rest
  }
  return { ...t }
})

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccessScrapErp(appUser.role)) {
    return NextResponse.json({ error: 'You do not have access to Scrap ERP.' }, { status: 403 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') || '').toLowerCase().trim()
    const location = searchParams.get('location')
    const department = searchParams.get('department')
    const scrapType = searchParams.get('scrapType')

    let filtered = [...globalTransactions]

    if (search) {
      filtered = filtered.filter(
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
      filtered = filtered.filter((tx) => tx.locationId === location || tx.locationName === location)
    }
    if (department && department !== 'all') {
      filtered = filtered.filter((tx) => tx.departmentId === department || tx.departmentName === department)
    }
    if (scrapType && scrapType !== 'all') {
      filtered = filtered.filter((tx) => tx.scrapTypeId === scrapType || tx.scrapTypeName === scrapType)
    }

    return NextResponse.json({
      success: true,
      transactions: filtered,
      totalCount: filtered.length,
    })
  } catch (error) {
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

    const nextNumber = `SCRAP-${new Date().getFullYear()}-${String(globalTransactions.length + 482).padStart(4, '0')}`

    const newTransaction: ScrapTransaction = {
      id: `tx-${Date.now()}`,
      transactionNumber: nextNumber,
      timestamp: body.timestamp || new Date().toISOString(),
      groupId: body.groupId || 'grp-1',
      groupName: body.groupName || 'JAM',
      locationId: body.locationId || 'loc-1',
      locationName: body.locationName || 'Dealership Location',
      departmentId: body.departmentId || 'dept-1',
      departmentName: body.departmentName || 'SERVICE',
      scrapTypeId: body.scrapTypeId || 'type-1',
      scrapTypeName: body.scrapTypeName || 'PLASTIC',
      unit: body.unit || 'Kg',
      description: body.description || 'Scrap Disposal Entry',
      weightQty,
      ratePerUnit,
      calculatedTotal,
      amountReceived,
      outstandingAmount,
      soldById: body.soldById || 'emp-1',
      soldByName: body.soldByName || 'Staff Member',
      soldTo: body.soldTo || 'Local Vendor',
      soldDate: body.soldDate || new Date().toISOString().split('T')[0],
      paymentModeId: body.paymentModeId || 'pm-1',
      paymentModeName: body.paymentModeName || 'CASH',
      paymentHandoverToId: body.paymentHandoverToId || 'ho-1',
      paymentHandoverToName: body.paymentHandoverToName || 'Accounts Team',
      remarks: body.remarks || '',
      status: outstandingAmount >= 1 ? 'FLAGGED' : 'COMPLETED',
      attachments: body.attachments || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    globalTransactions = [newTransaction, ...globalTransactions]

    return NextResponse.json({
      success: true,
      transaction: newTransaction,
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

    const index = globalTransactions.findIndex((t) => t.id === id || t.transactionNumber === transactionNumber)
    if (index === -1) {
      return NextResponse.json({ error: 'Transaction record not found' }, { status: 404 })
    }

    const existing = globalTransactions[index]
    const existingDateStr = (existing.soldDate || existing.timestamp || existing.createdAt || '').slice(0, 10)
    const isPreJuly = existingDateStr < DISTRIBUTION_START_DATE

    // Strip isDistributed / distributedAt from body if this is a pre-July record — distribution only from July 2026
    const sanitizedBody = { ...body }
    if (isPreJuly) {
      delete sanitizedBody.isDistributed
      delete sanitizedBody.distributedAt
      delete sanitizedBody.distributedBy
    }

    const weightQty = sanitizedBody.weightQty !== undefined ? Number(sanitizedBody.weightQty) : existing.weightQty
    const ratePerUnit = sanitizedBody.ratePerUnit !== undefined ? Number(sanitizedBody.ratePerUnit) : existing.ratePerUnit
    const calculatedTotal = Math.round(weightQty * ratePerUnit * 100) / 100
    const amountReceived = sanitizedBody.amountReceived !== undefined ? Number(sanitizedBody.amountReceived) : calculatedTotal
    const outstandingAmount = Math.max(0, calculatedTotal - amountReceived)

    const updatedTransaction: ScrapTransaction = {
      ...existing,
      ...sanitizedBody,
      weightQty,
      ratePerUnit,
      calculatedTotal,
      amountReceived,
      outstandingAmount,
      status: outstandingAmount >= 1 ? 'FLAGGED' : 'COMPLETED',
      updatedAt: new Date().toISOString(),
    }

    globalTransactions[index] = updatedTransaction

    return NextResponse.json({
      success: true,
      transaction: updatedTransaction,
      message: 'Scrap transaction updated successfully',
    })
  } catch (error) {
    console.error('Error in PUT /api/scrap-erp:', error)
    return NextResponse.json({ error: 'Failed to update scrap transaction' }, { status: 500 })
  }
}
