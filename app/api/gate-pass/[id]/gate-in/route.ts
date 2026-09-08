import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePass, recordGateIn } from '@/lib/gate-pass/server'
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
      return NextResponse.json({ error: 'Please enter a valid Odometer IN reading.' }, { status: 400 })
    }

    const parkedLocation = String(form.get('parkedLocation') ?? '').trim()
    if (!parkedLocation) {
      return NextResponse.json({ error: 'Please specify the Parked Location.' }, { status: 400 })
    }

    const keyHandoverTo = String(form.get('keyHandoverTo') ?? '').trim()
    if (!keyHandoverTo) {
      return NextResponse.json({ error: 'Please specify who the key was handed over to.' }, { status: 400 })
    }

    const photoPaths: Record<string, string> = {}

    const photoOdometerIn = form.get('photoOdometerIn')
    if (photoOdometerIn instanceof File && photoOdometerIn.size > 0) {
      photoPaths['odometer_in'] = await uploadGateEvidence(passNo, 'odometer-in', photoOdometerIn)
    }

    const otherPhotos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    const photoKinds = form.getAll('photoKinds').map((k) => String(k))
    for (let i = 0; i < otherPhotos.length; i++) {
      const kind = photoKinds[i] || `extra-in-${i + 1}`
      if (!photoPaths[kind]) {
        photoPaths[kind] = await uploadGateEvidence(passNo, kind, otherPhotos[i])
      }
    }

    const notes = String(form.get('remarks') ?? form.get('notes') ?? '').trim() || null

    const result = await recordGateIn(id, {
      guardName,
      odometer,
      photoPaths,
      signaturePath: null,
      parkedLocation,
      keyHandoverTo,
      notes,
    })

    return NextResponse.json({
      ok: true,
      pass: result.pass,
      alreadyDone: result.alreadyDone,
      odoWentBackwards: result.odoWentBackwards,
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
