import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePass, recordGateOut } from '@/lib/gate-pass/server'
import { uploadGateEvidence } from '@/lib/gate-pass/storage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.create')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    const pass = await getGatePass(access.appUser, id)
    const passNo = pass.passNo || id

    const form = await request.formData()

    const guardName = String(form.get('guardName') ?? '').trim() || access.appUser.fullName || 'Security'

    const rawOdo = String(form.get('odometer') ?? '').trim()
    const odometer = rawOdo === '' ? null : Number(rawOdo)
    if (odometer === null || !Number.isFinite(odometer) || odometer < 0) {
      return NextResponse.json({ error: 'Please enter a valid Odometer OUT reading.' }, { status: 400 })
    }

    const photoPaths: Record<string, string> = {}

    // 5 standard vehicle photos: Front, Back, Right, Left, Odometer
    const photoFront = form.get('photoFront')
    if (photoFront instanceof File && photoFront.size > 0) {
      photoPaths['front'] = await uploadGateEvidence(passNo, 'front', photoFront)
    }

    const photoBack = form.get('photoBack')
    if (photoBack instanceof File && photoBack.size > 0) {
      photoPaths['back'] = await uploadGateEvidence(passNo, 'back', photoBack)
    }

    const photoRight = form.get('photoRight')
    if (photoRight instanceof File && photoRight.size > 0) {
      photoPaths['right'] = await uploadGateEvidence(passNo, 'right', photoRight)
    }

    const photoLeft = form.get('photoLeft')
    if (photoLeft instanceof File && photoLeft.size > 0) {
      photoPaths['left'] = await uploadGateEvidence(passNo, 'left', photoLeft)
    }

    const photoOdometer = form.get('photoOdometer')
    if (photoOdometer instanceof File && photoOdometer.size > 0) {
      photoPaths['odometer'] = await uploadGateEvidence(passNo, 'odometer', photoOdometer)
    }

    // Process any additional generic photos
    const otherPhotos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    const photoKinds = form.getAll('photoKinds').map((k) => String(k))
    for (let i = 0; i < otherPhotos.length; i++) {
      const kind = photoKinds[i] || `extra-${i + 1}`
      if (!photoPaths[kind]) {
        photoPaths[kind] = await uploadGateEvidence(passNo, kind, otherPhotos[i])
      }
    }

    const notes = String(form.get('notes') ?? '').trim() || null

    const result = await recordGateOut(
      id,
      {
        guardName,
        odometer,
        photoPaths,
        signaturePath: null,
        notes,
      },
      request
    )

    return NextResponse.json({ ok: true, pass: result.pass, alreadyDone: result.alreadyDone })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
