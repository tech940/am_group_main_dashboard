import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess, visibleDealerCodes } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { GatePassError } from '@/lib/gate-pass/server'
import { listCandidateDrivers, maskLicence, upsertDriverProfile } from '@/lib/gate-pass/drivers'
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
  const access = await requireGatePassAccess('gate_pass.create')
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
 * Record or update a licence.
 *
 * Accepts multipart/form-data (with an optional photo) or JSON. Both, because the request form
 * sends a photo and other callers should not have to build a FormData to set an expiry date.
 *
 * A person may always record their OWN licence. Recording somebody else's needs `gate_pass.edit` —
 * it is a government ID being entered on another person's behalf, so it should leave a trail of who
 * did it rather than being an ambient capability everyone holds.
 */
export async function POST(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.create')
  if (access.denied) return access.denied

  try {
    const contentType = request.headers.get('content-type') ?? ''
    const isMultipart = contentType.includes('multipart/form-data')

    let userId = ''
    let licenceNo = ''
    let rawExpiry = ''
    let phone: string | null = null
    let licenceName: string | null = null
    let photo: File | null = null

    if (isMultipart) {
      const form = await request.formData()
      userId = String(form.get('userId') ?? '')
      licenceNo = String(form.get('licenceNo') ?? '')
      rawExpiry = String(form.get('licenceExpiry') ?? '')
      phone = String(form.get('phone') ?? '') || null
      licenceName = String(form.get('licenceName') ?? '') || null
      const candidate = form.get('licencePhoto')
      photo = candidate instanceof File && candidate.size > 0 ? candidate : null
    } else {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>
      userId = typeof body.userId === 'string' ? body.userId : ''
      licenceNo = typeof body.licenceNo === 'string' ? body.licenceNo : ''
      rawExpiry = typeof body.licenceExpiry === 'string' ? body.licenceExpiry : ''
      phone = typeof body.phone === 'string' ? body.phone : null
      licenceName = typeof body.licenceName === 'string' ? body.licenceName : null
    }

    const targetUserId = userId || access.appUser.id
    if (targetUserId !== access.appUser.id) {
      const elevated = await requireGatePassAccess('gate_pass.edit')
      if (elevated.denied) {
        throw new GatePassError('You can only record your own driving licence.', 403)
      }
    }

    if (!licenceNo.trim()) throw new GatePassError('A licence number is required.')

    const day = rawExpiry.slice(0, 10)
    const licenceExpiry = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
    if (rawExpiry && !licenceExpiry) {
      throw new GatePassError('That expiry date is not valid.')
    }

    // Upload BEFORE the row is written, so a failed upload does not leave a record pointing at
    // nothing. Omitting the field entirely (rather than sending null) keeps any existing photo.
    const licenceDocPath = photo ? await uploadDriverLicence(targetUserId, photo) : undefined

    await upsertDriverProfile({
      userId: targetUserId,
      licenceNo,
      licenceExpiry,
      phone,
      licenceName,
      licenceDocPath,
      updatedBy: access.appUser.id,
    })

    // The echo is masked too — a successful write must not hand the number straight back.
    return NextResponse.json({
      ok: true,
      licenceMasked: maskLicence(licenceNo),
      hasLicencePhoto: Boolean(licenceDocPath),
    })
  } catch (error) {
    if (error instanceof GatePassUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return gatePassErrorResponse(error)
  }
}
