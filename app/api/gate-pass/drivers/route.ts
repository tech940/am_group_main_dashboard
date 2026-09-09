import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess, visibleDealerCodes } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { GatePassError } from '@/lib/gate-pass/server'
import { listCandidateDrivers, maskLicence, upsertDriverProfile, createCandidateDriver } from '@/lib/gate-pass/drivers'
import { GatePassUploadError, uploadDriverLicence } from '@/lib/gate-pass/storage'

export const dynamic = 'force-dynamic'
/** A licence photo from a phone can be several MB on a slow connection. */
export const maxDuration = 60

/**
 * The driver picker, and the licence record behind it.
 *
 * ⚠️ THE LIST NEVER CARRIES A FULL LICENCE NUMBER OR A STORAGE PATH. Both are reduced here, at the
 * point they leave the server — not in the component. Masking client-side is how PII leaks: the
 * data is already on the wire and merely hidden in the render.
 */
export async function GET(_request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const drivers = await listCandidateDrivers(visibleDealerCodes(access.appUser))
    return NextResponse.json({
      drivers: drivers.map((d) => ({
        userId: d.userId,
        fullName: d.fullName,
        email: d.email,
        role: d.role,
        phone: d.phone,
        licenceMasked: maskLicence(d.licenceNo),
        licenceName: d.licenceName,
        hasLicence: Boolean(d.licenceNo),
        // A boolean, not the path. Whether a photo exists is useful; where it lives is not.
        hasLicencePhoto: Boolean(d.licenceDocPath),
        licenceExpiry: d.licenceExpiry,
        expired: d.expired,
      })),
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}

/**
 * Record or update a licence, or create a new employee driver.
 *
 * Accepts multipart/form-data (with an optional photo) or JSON.
 */
export async function POST(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.create')
  if (access.denied) return access.denied

  try {
    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.includes('multipart/form-data')

    let action = ''
    let userId = ''
    let fullName = ''
    let licenceNo = ''
    let rawExpiry = ''
    let phone: string | null = null
    let licenceName: string | null = null
    let photo: File | null = null

    if (isMultipart) {
      const form = await request.formData()
      action = String(form.get('action') ?? '')
      userId = String(form.get('userId') ?? '')
      fullName = String(form.get('fullName') ?? '')
      licenceNo = String(form.get('licenceNo') ?? '')
      rawExpiry = String(form.get('licenceExpiry') ?? '')
      phone = String(form.get('phone') ?? '') || null
      licenceName = String(form.get('licenceName') ?? '') || null
      const candidate = form.get('licencePhoto')
      photo = candidate instanceof File && candidate.size > 0 ? candidate : null
    } else {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>
      action = typeof body.action === 'string' ? body.action : ''
      userId = typeof body.userId === 'string' ? body.userId : ''
      fullName = typeof body.fullName === 'string' ? body.fullName : ''
      licenceNo = typeof body.licenceNo === 'string' ? body.licenceNo : ''
      rawExpiry = typeof body.licenceExpiry === 'string' ? body.licenceExpiry : ''
      phone = typeof body.phone === 'string' ? body.phone : null
      licenceName = typeof body.licenceName === 'string' ? body.licenceName : null
    }

    // Handle creating a new KIA employee driver
    if (action === 'create_employee' || (!userId && fullName.trim())) {
      const newDriver = await createCandidateDriver({
        fullName: fullName.trim(),
        phone: phone || undefined,
        dealers: access.appUser.dealers || 'JK402,JK501',
        actorId: access.appUser.id,
      })
      userId = newDriver.userId
    }

    const targetUserId = userId || access.appUser.id
    const finalLicenceNo = licenceNo.trim() || 'VERIFIED'

    const day = rawExpiry.slice(0, 10)
    const licenceExpiry = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null

    // Upload BEFORE the row is written, so a failed upload does not leave a record pointing at
    // nothing. Omitting the field entirely (rather than sending null) keeps any existing photo.
    const licenceDocPath = photo ? await uploadDriverLicence(targetUserId, photo) : undefined

    if (licenceNo || licenceExpiry || phone || licenceName || photo) {
      await upsertDriverProfile({
        userId: targetUserId,
        licenceNo: finalLicenceNo,
        licenceExpiry,
        phone,
        licenceName,
        licenceDocPath,
        updatedBy: access.appUser.id,
      })
    }

    // The echo is masked too — a successful write must not hand the number straight back.
    return NextResponse.json({
      ok: true,
      userId: targetUserId,
      licenceMasked: maskLicence(finalLicenceNo),
      hasLicencePhoto: Boolean(licenceDocPath),
    })
  } catch (error) {
    if (error instanceof GatePassUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return gatePassErrorResponse(error)
  }
}

