import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { discountApprovals } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { type BranchValue } from '@/lib/branches'

export const dynamic = 'force-dynamic'

// 1. GET - Fetch all discount approval requests (requires authentication)
export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const branchParam = searchParams.get('branch')

    let rows
    if (branchParam) {
      rows = await db
        .select()
        .from(discountApprovals)
        .where(eq(discountApprovals.branch, branchParam.toLowerCase().trim()))
        .orderBy(desc(discountApprovals.createdAt))
    } else {
      rows = await db
        .select()
        .from(discountApprovals)
        .orderBy(desc(discountApprovals.createdAt))
    }

    // Filter rows by authorized brand access
    const allowedRows = rows.filter((row) =>
      canAccessBrand(appUser, row.branch as BranchValue)
    )

    // Enrich each row with booking details in parallel
    const enrichedRows = await Promise.all(
      allowedRows.map(async (row) => {
        let booking: any = null
        const upperVin = row.customerId.toUpperCase()
        const normalizedBranch = row.branch.toLowerCase()

        try {
          if (normalizedBranch === 'hyundai') {
            // First try resolving via hyundai_sales_report if it's a VIN
            let orderRefNo = ''
            const salesResult = await db.execute(sql.raw(`
              SELECT order_ref_no 
              FROM hyundai_sales_report 
              WHERE UPPER(vin_number) = '${upperVin.replace(/'/g, "''")}' 
              LIMIT 1
            `))
            if (salesResult.length > 0) {
              orderRefNo = String(salesResult[0].order_ref_no)
            }

            let queryStr = ''
            if (orderRefNo) {
              queryStr = `SELECT * FROM hyundai_booking_report WHERE order_ref_no = '${orderRefNo.replace(/'/g, "''")}' LIMIT 1`
            } else {
              queryStr = `SELECT * FROM hyundai_booking_report WHERE (UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}' OR UPPER(customer_id) = '${upperVin.replace(/'/g, "''")}') LIMIT 1`
            }
            const bookingResult = await db.execute(sql.raw(queryStr))
            booking = bookingResult[0] || null
          } else if (normalizedBranch === 'platinum') {
            const bookingResult = await db.execute(sql.raw(`
              SELECT * FROM am_platinum_booking_report 
              WHERE (UPPER(customer_id) = '${upperVin.replace(/'/g, "''")}' OR UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}') 
              LIMIT 1
            `))
            booking = bookingResult[0] || null
          }
        } catch (err) {
          console.error(`Error loading booking for row ${row.id}:`, err)
        }

        return {
          ...row,
          bookingData: booking,
        }
      })
    )

    return NextResponse.json(enrichedRows)
  } catch (error) {
    console.error('Error fetching discount approvals:', error)
    return NextResponse.json({ error: 'Failed to fetch discount approvals' }, { status: 500 })
  }
}

// 2. POST - Public submission of a discount approval request (no auth required)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      requesterName,
      branch,
      customerId,
      customerName,
      model,
      variant,
      color,
      discountAmount,
      accessoriesAmount,
      tlManager,
      deliveryDate,
      reference,
    } = body

    if (!requesterName || !branch || !customerId || !discountAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Auto-learn new employees/managers
    const normalizedBranch = String(branch).trim().toLowerCase()
    
    // Check & Insert Sales Executive
    const reqName = String(requesterName).trim()
    const existingExec = await db.execute(sql.raw(`
      SELECT id FROM am_group_discount_approvals_employees 
      WHERE UPPER(name) = '${reqName.toUpperCase().replace(/'/g, "''")}' 
        AND branch = '${normalizedBranch}'
        AND role = 'sales_executive'
      LIMIT 1
    `))
    if (existingExec.length === 0) {
      await db.execute(sql.raw(`
        INSERT INTO am_group_discount_approvals_employees (name, role, branch)
        VALUES ('${reqName.replace(/'/g, "''")}', 'sales_executive', '${normalizedBranch}');
      `))
    }

    // Check & Insert Team Leader
    if (tlManager) {
      const tlName = String(tlManager).trim()
      const existingTL = await db.execute(sql.raw(`
        SELECT id FROM am_group_discount_approvals_employees 
        WHERE UPPER(name) = '${tlName.toUpperCase().replace(/'/g, "''")}' 
          AND branch = '${normalizedBranch}'
          AND role = 'team_leader'
        LIMIT 1
      `))
      if (existingTL.length === 0) {
        await db.execute(sql.raw(`
          INSERT INTO am_group_discount_approvals_employees (name, role, branch)
          VALUES ('${tlName.replace(/'/g, "''")}', 'team_leader', '${normalizedBranch}');
        `))
      }
    }

    const newApproval = await db.insert(discountApprovals).values({
      requesterName: String(requesterName).trim(),
      branch: String(branch).trim().toLowerCase(),
      customerId: String(customerId).trim(),
      customerName: customerName ? String(customerName).trim() : null,
      model: model ? String(model).trim() : null,
      variant: variant ? String(variant).trim() : null,
      color: color ? String(color).trim() : null,
      discountAmount: String(discountAmount),
      accessoriesAmount: accessoriesAmount ? String(accessoriesAmount) : null,
      tlManager: tlManager ? String(tlManager).trim() : null,
      deliveryDate: deliveryDate || null,
      reference: reference ? String(reference).trim() : null,
      status: 'PENDING_SM',
    }).returning()

    return NextResponse.json({
      message: 'Discount approval request submitted successfully.',
      data: newApproval[0],
    })
  } catch (error) {
    console.error('Error submitting discount approval request:', error)
    return NextResponse.json({ error: 'Failed to submit discount approval request' }, { status: 500 })
  }
}

// 3. PATCH - Update status of a discount approval request (requires authentication)
export async function PATCH(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, status, remarks } = body // status is the action: 'APPROVED' or 'REJECTED'

    if (!id || !status) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid action value' }, { status: 400 })
    }

    // 1. Fetch current request state
    const currentRequestList = await db
      .select()
      .from(discountApprovals)
      .where(eq(discountApprovals.id, id))

    if (currentRequestList.length === 0) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    const reqItem = currentRequestList[0]

    // 2. Prevent updating already processed requests
    if (reqItem.status === 'APPROVED' || reqItem.status === 'REJECTED') {
      return NextResponse.json({ error: 'Request has already been processed' }, { status: 400 })
    }

    // 3. Validate stage authorization (Strict stage clearing: only active stage role or superadmin can act)
    let allowed = false
    const role = (appUser.role || '').toLowerCase()

    if (role === 'developer' || role === 'admin') {
      allowed = true
    } else if (reqItem.status === 'PENDING_SM' && role === 'sales_manager') {
      allowed = true
    } else if ((reqItem.status === 'PENDING_VP' || reqItem.status === 'PENDING_GSM') && (role === 'general_manager' || role === 'vp')) {
      allowed = true
    } else if (reqItem.status === 'PENDING_MD' && role === 'md') {
      allowed = true
    }

    if (!allowed) {
      return NextResponse.json({ error: 'You are not authorized to approve/reject at this stage' }, { status: 403 })
    }

    // 4. Compute next status
    let nextStatus = 'REJECTED'
    if (status === 'APPROVED') {
      if (reqItem.status === 'PENDING_SM') {
        nextStatus = 'PENDING_GSM'
      } else if (reqItem.status === 'PENDING_VP' || reqItem.status === 'PENDING_GSM') {
        nextStatus = 'PENDING_MD'
      } else if (reqItem.status === 'PENDING_MD') {
        nextStatus = 'APPROVED'
      } else {
        nextStatus = 'APPROVED'
      }
    } else {
      nextStatus = 'REJECTED'
    }

    // 5. Update request
    const updated = await db
      .update(discountApprovals)
      .set({
        status: nextStatus,
        remarks: remarks ? String(remarks).trim() : null,
        updatedAt: new Date(),
      })
      .where(eq(discountApprovals.id, id))
      .returning()

    return NextResponse.json({
      message: `Discount approval request processed successfully.`,
      data: updated[0],
    })
  } catch (error) {
    console.error('Error updating discount approval request:', error)
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 })
  }
}
