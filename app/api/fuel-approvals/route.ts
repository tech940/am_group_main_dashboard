import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { generateFuelRequestNumber } from '@/lib/fuel-approvals/request-number'
import type { FuelApprovalRecord } from '@/lib/fuel-approvals/types'

import { canViewFuelApprovals } from '@/lib/fuel-approvals/view-access'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ⚠️ This response carries submitter emails, slip URLs, remarks and the full history array — and
    // every history entry holds the email of whoever acted. It used to check ONLY an explicit Access-Map
    // DENY, which almost nobody has set, so in practice every signed-in employee could read every fuel
    // record in the company. canViewFuelApprovals is the single statement of who may read this section,
    // shared with app/fuel-approvals/page.tsx and the last-fuel route so the three cannot drift apart —
    // the guard/API desync that has caused four separate outages in this codebase.
    if (!(await canViewFuelApprovals(user))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const tab = searchParams.get('tab') || 'all'
    const location = searchParams.get('location') || 'ALL'
    const search = searchParams.get('search')?.trim().toLowerCase() || ''

    const role = user.role.trim().toLowerCase()
    const isDeveloper = role === 'developer' || role === 'admin'
    const isCeo = role === 'ceo' || role === 'ed'
    const isAccounts = role === 'accounts' || role === 'finance_head' || role === 'finance_team'
    const isEa = role === 'ea' || role === 'eba'
    const isMd = role === 'md'

    // Fetch all records for the brand (ordered by created_at DESC)
    const records = await db
      .select()
      .from(fuelApprovals)
      .orderBy(desc(fuelApprovals.createdAt))

    // Compute counts
    let ceoPendingCount = 0
    let accountsPendingCount = 0
    let eaPendingCount = 0
    let mdPendingCount = 0
    let approvedCount = 0
    let heldCount = 0
    let sentBackCount = 0
    let rejectedCount = 0
    let totalLitersApproved = 0

    for (const row of records) {
      if (row.status === 'ceo_pending' || row.status === 'ed_pending') ceoPendingCount++
      if (row.status === 'accounts_pending') accountsPendingCount++
      if (row.status === 'ea_pending' || row.status === 'hr_pending') eaPendingCount++
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
      userPendingCount = ceoPendingCount + accountsPendingCount + eaPendingCount + mdPendingCount
    } else if (isCeo) {
      userPendingCount = ceoPendingCount
    } else if (isAccounts) {
      userPendingCount = accountsPendingCount + eaPendingCount + mdPendingCount
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
          if (!['ceo_pending', 'accounts_pending', 'ea_pending', 'md_pending', 'ed_pending', 'hr_pending'].includes(row.status)) return false
        } else if (isCeo) {
          if (row.status !== 'ceo_pending' && row.status !== 'ed_pending') return false
        } else if (isAccounts) {
          if (row.status !== 'accounts_pending' && row.status !== 'ea_pending' && row.status !== 'md_pending' && row.status !== 'hr_pending') return false
        } else {
          // Non-approvers have no pending approvals in their inbox
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
        ceoPending: ceoPendingCount,
        accountsPending: accountsPendingCount,
        eaPending: eaPendingCount,
        mdPending: mdPendingCount,
        edPending: ceoPendingCount,
        hrPending: eaPendingCount,
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
        canApproveCeo: isCeo || isDeveloper,
        canApproveAccounts: isAccounts || isDeveloper,
        canApproveEa: isEa || isDeveloper,
        canApproveMd: isMd || isDeveloper,
        canApproveEd: isCeo || isDeveloper,
        canApproveHr: isEa || isDeveloper,
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
      // ⚠️ No `details`: a raw driver message names columns and constraints to any caller.
      { error: 'Failed to fetch fuel approvals' },
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

    // Raising a fuel request requires being able to open Fuel Approvals — the same predicate as the list
    // above. A login alone used to be enough, so the section's restriction could be walked around by
    // posting straight to this route.
    if (!(await canViewFuelApprovals(user))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // A malformed body used to throw here and answer 500 "Failed to create" — an error that reads like
    // the database refused the record when in fact nothing was ever attempted.
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

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
      // ── Fuel intelligence fields (migration 0063) ──
      energyType,
      quantityUnit,
      totalCost,
      odometerKm,
      isFullTank,
      vehicleVin,
      assetCode,
      driverUserId,
      driverName,
      stationName,
      stationLocation,
      odometerOverride,
    } = body as Record<string, unknown>

    if (!location || !fuelRequiredFor || !vehRegNo || !vinNo || !fuelType || !fuelFilledDate || !fuelFilledLtrs || !fuelSlipUrl) {
      return NextResponse.json({ error: 'Please fill all required fields and attach fuel slip' }, { status: 400 })
    }

    const parsedLtrs = parseFloat(String(fuelFilledLtrs))
    if (isNaN(parsedLtrs) || parsedLtrs <= 0) {
      return NextResponse.json({ error: 'Please enter a valid fuel quantity in liters' }, { status: 400 })
    }

    // ⚠️ Recording an odometer override is an AUTHORISATION, not a form field: it tells the engine that
    // someone with fuel_management.edit accepted an abnormal reading, and it suppresses the mileage for
    // that stretch. Accepting it from whoever posts the form would let any submitter silence the very
    // check that protects the numbers. The authorised path is built with the settings screen.
    if (odometerOverride === true) {
      return NextResponse.json(
        { error: 'An odometer override cannot be set from this form. Ask an authorised approver to record it.' },
        { status: 403 }
      )
    }

    // The unit decides what fuelFilledLtrs MEANS, so an unknown one cannot be stored — km/L, km/kg and
    // km/kWh are never mixed. Both lists mirror the CHECK constraints added in 0063.
    const energy = energyType == null || energyType === '' ? null : String(energyType).trim().toLowerCase()
    if (energy !== null && !['petrol', 'diesel', 'cng', 'ev', 'hybrid'].includes(energy)) {
      return NextResponse.json({ error: 'Unknown energy type' }, { status: 400 })
    }
    const unit = quantityUnit == null || quantityUnit === '' ? 'L' : String(quantityUnit).trim()
    if (!['L', 'kg', 'kWh'].includes(unit)) {
      return NextResponse.json({ error: 'Quantity must be measured in L, kg or kWh' }, { status: 400 })
    }

    // The RECEIPT TOTAL. Price per unit is derived from it and is deliberately not stored.
    let cost: number | null = null
    if (totalCost != null && String(totalCost).trim() !== '') {
      cost = parseFloat(String(totalCost))
      if (isNaN(cost) || cost <= 0) {
        return NextResponse.json({ error: 'Enter the total amount on the receipt' }, { status: 400 })
      }
    }

    let odometer: number | null = null
    if (odometerKm != null && String(odometerKm).trim() !== '') {
      odometer = parseFloat(String(odometerKm))
      if (isNaN(odometer) || odometer < 0) {
        return NextResponse.json({ error: 'Enter a valid odometer reading' }, { status: 400 })
      }
    }

    // A VIN and an asset code are mutually exclusive — 0063 enforces it, and a 23514 from Postgres would
    // surface as an unexplained 500.
    const resolvedVin = vehicleVin == null || String(vehicleVin).trim() === '' ? null : String(vehicleVin).trim().toUpperCase()
    const resolvedAsset = assetCode == null || String(assetCode).trim() === '' ? null : String(assetCode).trim().toUpperCase()
    if (resolvedVin && resolvedAsset) {
      return NextResponse.json({ error: 'An entry belongs to a vehicle or an asset, not both' }, { status: 400 })
    }

    const requestNumber = await generateFuelRequestNumber()
    const nowIso = new Date().toISOString()
    const trimmedRemarks = remarks == null || String(remarks).trim() === '' ? null : String(remarks).trim()

    const initialHistory = [
      {
        id: crypto.randomUUID(),
        action: 'SUBMIT',
        stage: 'submitter',
        userId: user.id,
        userName: user.fullName,
        userEmail: user.email,
        userRole: user.role,
        remarks: trimmedRemarks ?? 'Initial submission',
        timestamp: nowIso,
      },
    ]

    const text = (value: unknown): string | null => {
      if (value == null) return null
      const s = String(value).trim()
      return s === '' ? null : s
    }

    const [inserted] = await db
      .insert(fuelApprovals)
      .values({
        requestNumber,
        brand: 'kia',
        location: String(location),
        fuelRequiredFor: String(fuelRequiredFor),
        vehRegNo: String(vehRegNo).trim(),
        vinNo: String(vinNo).trim(),
        lastFuelFilledDate: text(lastFuelFilledDate),
        fuelType: String(fuelType),
        currentKmReading: text(currentKmReading),
        fuelFilledDate: String(fuelFilledDate),
        fuelFilledLtrs: parsedLtrs.toFixed(2),
        fuelSlipUrl: String(fuelSlipUrl),
        remarks: trimmedRemarks,
        status: 'ceo_pending',
        currentStage: 'ceo',
        submittedById: user.id,
        submittedByName: user.fullName,
        submittedByEmail: user.email,
        history: initialHistory,

        // ── Fuel intelligence (0063) ──
        // Each one is stored exactly as given or left NULL. ⚠️ Nothing here defaults to 0: a missing
        // receipt total or odometer must read as "not recorded", because a 0 would enter an average and
        // quietly drag a vehicle's cost per km toward zero.
        energyType: energy,
        quantityUnit: unit,
        totalCost: cost === null ? null : cost.toFixed(2),
        odometerKm: odometer === null ? null : odometer.toFixed(1),
        // Only a real boolean counts. Anything else is "not recorded", never a silent "no".
        isFullTank: typeof isFullTank === 'boolean' ? isFullTank : null,
        vehicleVin: resolvedVin,
        assetCode: resolvedAsset,
        driverUserId: text(driverUserId),
        driverName: text(driverName),
        stationName: text(stationName),
        stationLocation: text(stationLocation),
      })
      .returning()

    return NextResponse.json({
      item: inserted,
      message: `Fuel approval request ${requestNumber} created successfully`,
    })
  } catch (error) {
    console.error('Error creating fuel approval request:', error)
    // ⚠️ No `details` here. A driver message names columns and constraints, and this route is reachable
    // by anyone who can submit a fuel entry.
    return NextResponse.json({ error: 'Failed to create fuel approval request' }, { status: 500 })
  }
}
