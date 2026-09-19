import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { discountApprovals, discountApprovalsEmployees } from '@/lib/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import {
  canAccessDiscountBranch,
  canViewDiscountApprovals,
  discountBranchesFor,
  isDiscountApprovalBranch,
} from '@/lib/discount-approvals/access'

export const dynamic = 'force-dynamic'

let isSchemaMigrated = false

async function ensureSchema() {
  if (isSchemaMigrated) return
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS discount_approvals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        customer_name TEXT,
        model TEXT,
        variant TEXT,
        color TEXT,
        discount_amount NUMERIC(14, 2) NOT NULL,
        accessories_amount NUMERIC(14, 2),
        tl_manager TEXT,
        tele_date DATE,
        insurance_type TEXT,
        delivery_date DATE,
        reference TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING_GSM',
        remarks TEXT,
        history JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS am_group_discount_approvals_employees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        branch TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE discount_approvals ADD COLUMN IF NOT EXISTS tele_date date;
      ALTER TABLE discount_approvals ADD COLUMN IF NOT EXISTS insurance_type text;
      ALTER TABLE discount_approvals ADD COLUMN IF NOT EXISTS history jsonb DEFAULT '[]'::jsonb;
    `))
    isSchemaMigrated = true
  } catch (err) {
    console.error('Auto migration warning for discount_approvals:', err)
  }
}

// 1. GET - Fetch all discount approval requests (requires authentication)
export async function GET(request: NextRequest) {
  try {
    await ensureSchema()

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // ⚠️ This used to check only "logged in" — any employee with brand access could read every request.
    // Now the section permission, and only the branches this user may see (lib/discount-approvals/access).
    const allowedBranches = await discountBranchesFor(appUser)
    if (allowedBranches.length === 0) {
      return NextResponse.json({ error: 'You do not have access to discount approvals' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const branchParam = (searchParams.get('branch') || '').trim().toLowerCase()
    const branches = branchParam && branchParam !== 'all'
      ? allowedBranches.filter((b) => b === branchParam)
      : allowedBranches
    if (branches.length === 0) return NextResponse.json([])

    const rows = await db
      .select()
      .from(discountApprovals)
      .where(inArray(sql`LOWER(${discountApprovals.branch})`, branches))
      .orderBy(desc(discountApprovals.createdAt))

    return NextResponse.json(rows)
  } catch (error) {
    console.error('Error fetching discount approvals:', error)
    return NextResponse.json({ error: 'Failed to fetch discount approvals' }, { status: 500 })
  }
}

// 2. POST - Public submission of a discount approval request (no auth required)
export async function POST(request: NextRequest) {
  try {
    await ensureSchema()
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
      teleDate,
      insuranceType,
      reference,
    } = body

    if (!requesterName || !branch || !customerId || !discountAmount || !teleDate || !insuranceType) {
      return NextResponse.json({ error: 'Missing required fields (Tele Date & Insurance Type are required)' }, { status: 400 })
    }

    /*
     * ⚠️ PUBLIC route (the no-login submit forms), so every value is untrusted. `branch` used to be pasted
     * into sql.raw() unescaped — an unauthenticated SQL injection, found in the Sep 2026 audit. It is now
     * one of the two known branches, and nothing below builds SQL from a string.
     */
    const normalizedBranch = String(branch).trim().toLowerCase()
    if (!isDiscountApprovalBranch(normalizedBranch)) {
      return NextResponse.json({ error: 'Invalid branch selection' }, { status: 400 })
    }
    const reqName = String(requesterName).trim()
    const tlName = tlManager ? String(tlManager).trim() : ''
    const amount = Number(discountAmount)
    const accessories = accessoriesAmount === undefined || accessoriesAmount === null || accessoriesAmount === '' ? null : Number(accessoriesAmount)
    const tele = String(teleDate).trim()
    const tooLong = [reqName, tlName, String(customerId), String(customerName ?? ''), String(model ?? ''), String(variant ?? ''), String(color ?? '')]
      .some((v) => v.length > 120) || String(reference ?? '').length > 500
    if (!reqName || tooLong) {
      return NextResponse.json({ error: 'One of the fields is empty or too long' }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 || (accessories !== null && (!Number.isFinite(accessories) || accessories < 0 || accessories > 10_000_000))) {
      return NextResponse.json({ error: 'Enter the discount (and accessories) amount as a number' }, { status: 400 })
    }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tele) || !['In House', 'Out House'].includes(String(insuranceType).trim())) {
      return NextResponse.json({ error: 'Tele Date must be a date and Insurance Type In House or Out House' }, { status: 400 })
    }

    // Auto-learn new sales executives / team leaders for the form's pickers.
    const learn = async (name: string, role: 'sales_executive' | 'team_leader') => {
      const [existing] = await db
        .select({ id: discountApprovalsEmployees.id })
        .from(discountApprovalsEmployees)
        .where(and(
          sql`UPPER(${discountApprovalsEmployees.name}) = ${name.toUpperCase()}`,
          eq(discountApprovalsEmployees.branch, normalizedBranch),
          eq(discountApprovalsEmployees.role, role),
        ))
        .limit(1)
      if (!existing) await db.insert(discountApprovalsEmployees).values({ name, role, branch: normalizedBranch })
    }
    await learn(reqName, 'sales_executive')
    if (tlName) await learn(tlName, 'team_leader')

    const initialHistory = [{
      action: 'SUBMITTED',
      actorName: reqName,
      actorRole: 'Sales Executive',
      timestamp: new Date().toISOString(),
      previousStatus: null,
      newStatus: 'PENDING_GSM',
      remarks: 'Discount approval request submitted',
    }]

    const newApproval = await db.insert(discountApprovals).values({
      requesterName: reqName,
      branch: normalizedBranch,
      customerId: String(customerId).trim(),
      customerName: customerName ? String(customerName).trim() : null,
      model: model ? String(model).trim() : null,
      variant: variant ? String(variant).trim() : null,
      color: color ? String(color).trim() : null,
      discountAmount: String(amount),
      accessoriesAmount: accessories === null ? null : String(accessories),
      tlManager: tlName || null,
      teleDate: tele,
      insuranceType: String(insuranceType).trim(),
      reference: reference ? String(reference).trim() : null,
      status: 'PENDING_GSM',
      history: initialHistory,
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
    await ensureSchema()
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

    // 3a. The section and THIS request's brand. Before 2026-09-19 only the role below was checked, so a
    // general_manager of any brand (KIA's included) could clear Hyundai's stage 1.
    if (!(await canViewDiscountApprovals(appUser)) || !(await canAccessDiscountBranch(appUser, String(reqItem.branch).toLowerCase()))) {
      return NextResponse.json({ error: 'You are not authorized to act on this brand\'s discount requests' }, { status: 403 })
    }

    // 3b. Validate stage authorization
    // Rule: Either General Sales Manager OR VP can approve Stage 1 (PENDING_GSM / PENDING_VP / PENDING_SM) -> sends straight to MD (PENDING_MD)!
    // Stage 2: MD (PENDING_MD) -> approves to APPROVED!
    let allowed = false
    const role = (appUser.role || '').toLowerCase()

    if (role === 'developer' || role === 'admin') {
      allowed = true
    } else if (['PENDING_GSM', 'PENDING_VP', 'PENDING_SM'].includes(reqItem.status) && (role === 'general_manager' || role === 'vp')) {
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
      if (['PENDING_GSM', 'PENDING_VP', 'PENDING_SM'].includes(reqItem.status)) {
        nextStatus = 'PENDING_MD'
      } else if (reqItem.status === 'PENDING_MD') {
        nextStatus = 'APPROVED'
      } else {
        nextStatus = 'APPROVED'
      }
    } else {
      nextStatus = 'REJECTED'
    }

    // 5. Append Activity Log
    const actorRoleLabel =
      role === 'general_manager' ? 'General Sales Manager' :
      role === 'vp' ? 'Vice President' :
      role === 'md' ? 'Managing Director (MD)' :
      role === 'admin' || role === 'developer' ? 'Super Admin' :
      role.toUpperCase()

    const newHistoryEntry = {
      action: status,
      actorName: appUser.fullName || appUser.email || 'System User',
      actorRole: actorRoleLabel,
      timestamp: new Date().toISOString(),
      previousStatus: reqItem.status,
      newStatus: nextStatus,
      remarks: remarks ? String(remarks).trim() : null,
    }

    const existingHistory = Array.isArray(reqItem.history) ? reqItem.history : []
    const updatedHistory = [...existingHistory, newHistoryEntry]

    // 6. Update request — only if nobody else moved it meanwhile. Two approvers pressing at once used to
    // both succeed and double the history.
    const updated = await db
      .update(discountApprovals)
      .set({
        status: nextStatus,
        remarks: remarks ? String(remarks).trim() : null,
        history: updatedHistory,
        updatedAt: new Date(),
      })
      .where(and(eq(discountApprovals.id, id), eq(discountApprovals.status, reqItem.status)))
      .returning()
    if (updated.length === 0) {
      return NextResponse.json({ error: 'Someone else has just acted on this request — refresh to see it' }, { status: 409 })
    }

    return NextResponse.json({
      message: `Discount approval request processed successfully.`,
      data: updated[0],
    })
  } catch (error) {
    console.error('Error updating discount approval request:', error)
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 })
  }
}
