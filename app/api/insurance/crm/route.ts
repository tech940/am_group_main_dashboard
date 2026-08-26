import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { getCrmRecords, saveCrmRecord, type CrmDisposition } from '@/lib/insurance/crm'

export const dynamic = 'force-dynamic'

export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewRestrictedAnalytics(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const records = await getCrmRecords()
    return NextResponse.json({ records })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch CRM records' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewRestrictedAnalytics(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    if (!body.chassisNo) {
      return NextResponse.json({ error: 'chassisNo is required' }, { status: 400 })
    }
    await saveCrmRecord({
      chassisNo: String(body.chassisNo),
      policyNo: body.policyNo ? String(body.policyNo) : null,
      customerName: body.customerName ? String(body.customerName) : null,
      phone: body.phone ? String(body.phone) : null,
      disposition: (body.disposition as CrmDisposition) || 'PENDING',
      lossReason: body.lossReason ? String(body.lossReason) : null,
      competitorDestination: body.competitorDestination ? String(body.competitorDestination) : null,
      remarks: body.remarks ? String(body.remarks) : null,
      followUpDate: body.followUpDate ? String(body.followUpDate) : null,
      calledBy: body.calledBy || appUser.email || 'Advisor',
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save CRM record' }, { status: 500 })
  }
}
