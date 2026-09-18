import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireInsuranceAccess } from '@/lib/insurance/access'
import { resolveBrand } from '@/lib/insurance/brands'
import { getCrmRecords, saveCrmRecord, type CrmDisposition } from '@/lib/insurance/crm'

export const dynamic = 'force-dynamic'

/*
 * ⚠️ `?type=` IS REQUIRED NOW. These records are keyed on chassis alone and carry no brand of their
 * own, so before the split they were readable by anyone who could reach the section. With three
 * brand-owned books the caller has to say WHICH book it is working in, or the permission cannot be
 * checked at all. resolveBrand defaults to hyundai for anything unrecognised, so a caller that omits
 * it is gated on Hyundai rather than waved through.
 */
export async function GET(request: Request) {
  const brand = resolveBrand(new URL(request.url).searchParams.get('type'))
  const gate = await requireInsuranceAccess(brand)
  if (gate.denied) return gate.denied

  try {
    const records = await getCrmRecords()
    return NextResponse.json({ records })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch CRM records' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    /*
     * ⚠️ 'edit', not 'view' — recording a call outcome is a WRITE, and the whole point of splitting
     * the action is that an insurance desk can be given it without being given the book to browse,
     * or given the book to read without the ability to change what it says.
     */
    const gate = await requireInsuranceAccess(resolveBrand(body?.brand), 'edit')
    if (gate.denied) return gate.denied
    const appUser = gate.appUser
    if (!body.chassisNo) {
      return NextResponse.json({ error: 'chassisNo is required' }, { status: 400 })
    }
    await saveCrmRecord({
      chassisNo: String(body.chassisNo),
      brand: body.brand ? String(body.brand) : null,
      policyNo: body.policyNo ? String(body.policyNo) : null,
      customerName: body.customerName ? String(body.customerName) : null,
      phone: body.phone ? String(body.phone) : null,
      registrationNo: body.registrationNo ? String(body.registrationNo) : null,
      model: body.model ? String(body.model) : null,
      variant: body.variant ? String(body.variant) : null,
      insuranceCompany: body.insuranceCompany ? String(body.insuranceCompany) : null,
      dealerCode: body.dealerCode ? String(body.dealerCode) : null,
      expiryDate: body.expiryDate ? String(body.expiryDate) : null,
      lastPremium: body.lastPremium !== undefined && body.lastPremium !== null ? Number(body.lastPremium) : null,
      disposition: (body.disposition as CrmDisposition) || 'PENDING',
      lossReason: body.lossReason ? String(body.lossReason) : null,
      competitorDestination: body.competitorDestination ? String(body.competitorDestination) : null,
      remarks: body.remarks ? String(body.remarks) : null,
      followUpDate: body.followUpDate ? String(body.followUpDate) : null,
      /*
       * ⚠️ FROM THE SESSION ONLY. This used to read `body.calledBy` first, so any caller could post a
       * disposition attributed to a colleague — on a record whose whole purpose is saying who spoke
       * to the customer. The client no longer sends it and the server would ignore it if it did.
       */
      calledBy: appUser.fullName || appUser.email || 'Unknown',
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save CRM record' }, { status: 500 })
  }
}
