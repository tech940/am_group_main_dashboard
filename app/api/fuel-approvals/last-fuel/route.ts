import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { desc, and, ne, or, ilike } from 'drizzle-orm'
import { canViewFuelApprovals } from '@/lib/fuel-approvals/view-access'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // The same rule app/fuel-approvals/page.tsx enforces. This used to check ONLY an explicit
    // Access-Map deny, so an employee the page turned away could still read any vehicle's last fill.
    if (!(await canViewFuelApprovals(user))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const vehicle = searchParams.get('vehicle')?.trim() || ''
    const vin = searchParams.get('vin')?.trim() || ''

    if (!vehicle && !vin) {
      return NextResponse.json({ lastFuel: null })
    }

    const plateMatch = vehicle.match(/[A-Z0-9]{4,12}$/i)?.[0] || ''

    const conditions = []
    if (vehicle) {
      conditions.push(ilike(fuelApprovals.vehRegNo, `%${vehicle}%`))
      if (plateMatch && plateMatch.length >= 4) {
        conditions.push(ilike(fuelApprovals.vehRegNo, `%${plateMatch}%`))
        conditions.push(ilike(fuelApprovals.vinNo, `%${plateMatch}%`))
      }
    }
    if (vin) {
      conditions.push(ilike(fuelApprovals.vinNo, `%${vin}%`))
      conditions.push(ilike(fuelApprovals.vehRegNo, `%${vin}%`))
    }

    const records = await db
      .select({
        id: fuelApprovals.id,
        requestNumber: fuelApprovals.requestNumber,
        fuelFilledDate: fuelApprovals.fuelFilledDate,
        fuelFilledLtrs: fuelApprovals.fuelFilledLtrs,
        currentKmReading: fuelApprovals.currentKmReading,
        vinNo: fuelApprovals.vinNo,
        vehRegNo: fuelApprovals.vehRegNo,
        fuelType: fuelApprovals.fuelType,
      })
      .from(fuelApprovals)
      .where(and(ne(fuelApprovals.status, 'rejected'), or(...conditions)))
      .orderBy(desc(fuelApprovals.fuelFilledDate), desc(fuelApprovals.createdAt))
      .limit(1)

    if (records.length === 0) {
      return NextResponse.json({ lastFuel: null })
    }

    const latest = records[0]
    const rawDate = latest.fuelFilledDate
    let formattedDate = ''
    if (rawDate) {
      const d = new Date(rawDate)
      formattedDate = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : String(rawDate).slice(0, 10)
    }

    return NextResponse.json({
      lastFuel: {
        fuelFilledDate: formattedDate,
        fuelFilledLtrs: latest.fuelFilledLtrs ? String(latest.fuelFilledLtrs) : null,
        currentKmReading: latest.currentKmReading || null,
        vinNo: latest.vinNo || null,
        vehRegNo: latest.vehRegNo || null,
        fuelType: latest.fuelType || null,
        requestNumber: latest.requestNumber,
      },
    })
  } catch (error) {
    console.error('Error fetching last fuel date:', error)
    return NextResponse.json(
      { error: 'Failed to fetch last fuel record', lastFuel: null },
      { status: 500 }
    )
  }
}
