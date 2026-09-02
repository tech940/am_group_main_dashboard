import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { desc, sql } from 'drizzle-orm'
import { generateFuelRequestNumber } from '@/lib/fuel-approvals/request-number'
import type { FuelApprovalRecord } from '@/lib/fuel-approvals/types'

import { isPermissionDenied } from '@/lib/permissions/deny'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (await isPermissionDenied(user, 'fuel_approvals.view')) {
      return NextResponse.json({ error: 'Access denied by administrator' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const tab = searchParams.get('tab') || 'all'
    const location = searchParams.get('location') || 'ALL'
    const search = searchParams.get('search')?.trim().toLowerCase() || ''

    const role = user.role.trim().toLowerCase()
    const isDeveloper = role === 'developer' || role === 'admin'
    const isEd = role === 'ed'
    const isHr = role === 'hr'
    const isMd = role === 'md' || role === 'ceo'

    // Fetch all records for the brand (ordered by created_at DESC)
    const records = await db
      .select()
      .from(fuelApprovals)
      .orderBy(desc(fuelApprovals.createdAt))

    // Compute counts
    let edPendingCount = 0
    let hrPendingCount = 0
    let mdPendingCount = 0
    let approvedCount = 0
    let heldCount = 0
    let sentBackCount = 0
    let rejectedCount = 0
    let totalLitersApproved = 0

    for (const row of records) {
      if (row.status === 'ed_pending') edPendingCount++
      if (row.status === 'hr_pending') hrPendingCount++
      if (row.status === 'md_pending') mdPendingCount++

      if (row.status === 'approved') {
        approvedCount++
        totalLitersApproved += parseFloat(row.fuelFilledLtrs as string) || 0
      } else if (row.status.includes('on_hold')) {
        heldCount++
      } else if (row.status === 'sent_back') {
        sentBackCount++
      } else if (row.status === 'rejected') {
        rejectedCount++
      }
    }

    // Role-specific pending count for current user
    let userPendingCount = 0
    if (isDeveloper) {
      userPendingCount = edPendingCount + hrPendingCount + mdPendingCount
    } else if (isEd) {
      userPendingCount = edPendingCount
    } else if (isHr) {
      userPendingCount = hrPendingCount
    } else if (isMd) {
      userPendingCount = mdPendingCount
    } else {
      userPendingCount = 0
    }

    // Filter items based on tab, location, and search
    const filtered = records.filter((row) => {
      // Location filter
      if (location !== 'ALL' && row.location !== location) {
        return false
      }

      // Tab filter
      if (tab === 'pending') {
        if (isDeveloper) {
          if (!['ed_pending', 'hr_pending', 'md_pending'].includes(row.status)) return false
        } else if (isEd) {
          // ED only ever sees ED pending
          if (row.status !== 'ed_pending') return false
        } else if (isHr) {
          // HR only ever sees HR pending
          if (row.status !== 'hr_pending') return false
        } else if (isMd) {
          // MD only ever sees MD pending
          if (row.status !== 'md_pending') return false
        } else {
          // Non-approvers have no pending approvals
          return false
        }
      } else if (tab === 'approved') {
        if (row.status !== 'approved') return false
      } else if (tab === 'held') {
        if (!row.status.includes('on_hold')) return false
      } else if (tab === 'sent_back') {
        if (row.status !== 'sent_back') return false
      } else if (tab === 'rejected') {
        if (row.status !== 'rejected') return false
      }

      // Search filter
      if (search) {
        const textToSearch = [
          row.requestNumber,
          row.vehRegNo,
          row.vinNo,
          row.location,
          row.fuelRequiredFor,
          row.submittedByName,
          row.submittedByEmail,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        if (!textToSearch.includes(search)) return false
      }

      return true
    })

    return NextResponse.json({
      items: filtered as unknown as FuelApprovalRecord[],
      counts: {
        pending: userPendingCount,
        edPending: edPendingCount,
        hrPending: hrPendingCount,
        mdPending: mdPendingCount,
        all: records.length,
        approved: approvedCount,
        held: heldCount,
        sentBack: sentBackCount,
        rejected: rejectedCount,
        totalLitersApproved: Math.round(totalLitersApproved * 100) / 100,
      },
      currentUser: {
        id: user.id,
        role: user.role,
        fullName: user.fullName,
        email: user.email,
        isDeveloper,
        canApproveEd: isEd || isDeveloper,
        canApproveHr: isHr || isDeveloper,
        canApproveMd: isMd || isDeveloper,
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      }
    })
  } catch (error) {
    console.error('Error fetching fuel approvals:', error)
    return NextResponse.json(
      { error: 'Failed to fetch fuel approvals', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      location,
      fuelRequiredFor,
      vehRegNo,
      vinNo,
      lastFuelFilledDate,
      fuelType,
      currentKmReading,
      fuelFilledDate,
      fuelFilledLtrs,
      fuelSlipUrl,
      remarks,
    } = body

    if (!location || !fuelRequiredFor || !vehRegNo || !vinNo || !fuelType || !fuelFilledDate || !fuelFilledLtrs || !fuelSlipUrl) {
      return NextResponse.json({ error: 'Please fill all required fields and attach fuel slip' }, { status: 400 })
    }

    const parsedLtrs = parseFloat(fuelFilledLtrs)
    if (isNaN(parsedLtrs) || parsedLtrs <= 0) {
      return NextResponse.json({ error: 'Please enter a valid fuel quantity in liters' }, { status: 400 })
    }

    const requestNumber = await generateFuelRequestNumber()
    const nowIso = new Date().toISOString()

    const initialHistory = [
      {
        id: crypto.randomUUID(),
        action: 'SUBMIT',
        stage: 'submitter',
        userId: user.id,
        userName: user.fullName,
        userEmail: user.email,
        userRole: user.role,
        remarks: remarks || 'Initial submission',
        timestamp: nowIso,
      },
    ]

    const [inserted] = await db
      .insert(fuelApprovals)
      .values({
        requestNumber,
        brand: 'kia',
        location,
        fuelRequiredFor,
        vehRegNo,
        vinNo,
        lastFuelFilledDate: lastFuelFilledDate || null,
        fuelType,
        currentKmReading: currentKmReading ? String(currentKmReading) : null,
        fuelFilledDate,
        fuelFilledLtrs: parsedLtrs.toFixed(2),
        fuelSlipUrl,
        remarks: remarks || null,
        status: 'ed_pending',
        currentStage: 'ed',
        submittedById: user.id,
        submittedByName: user.fullName,
        submittedByEmail: user.email,
        history: initialHistory,
      })
      .returning()

    return NextResponse.json({
      item: inserted,
      message: `Fuel approval request ${requestNumber} created successfully`,
    })
  } catch (error) {
    console.error('Error creating fuel approval request:', error)
    return NextResponse.json(
      { error: 'Failed to create fuel approval request', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
