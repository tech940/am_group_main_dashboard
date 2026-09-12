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

    const uploadTasks: Promise<void>[] = []

    const photoOdometerIn = form.get('photoOdometerIn')
    if (photoOdometerIn instanceof File && photoOdometerIn.size > 0) {
      uploadTasks.push(
        uploadGateEvidence(passNo, 'odometer-in', photoOdometerIn).then((path) => {
          photoPaths['odometer_in'] = path
        }),
      )
    }

    const otherPhotos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    const photoKinds = form.getAll('photoKinds').map((k) => String(k))
    for (let i = 0; i < otherPhotos.length; i++) {
      const kind = photoKinds[i] || `extra-in-${i + 1}`
      if (!photoPaths[kind]) {
        uploadTasks.push(
          uploadGateEvidence(passNo, kind, otherPhotos[i]).then((path) => {
            photoPaths[kind] = path
          }),
        )
      }
    }

    let fuelSlipPath: string | null = pass.fuelSlipPath || null
    let pumpStartPath: string | null = pass.pumpStartPath || null
    let pumpStopPath: string | null = pass.pumpStopPath || null

    const fuelSlipFile = form.get('fuelSlip')
    if (fuelSlipFile instanceof File && fuelSlipFile.size > 0) {
      uploadTasks.push(
        uploadGateEvidence(passNo, 'fuel-slip', fuelSlipFile).then((path) => {
          fuelSlipPath = path
        }),
      )
    }

    const pumpStartFile = form.get('pumpStart')
    if (pumpStartFile instanceof File && pumpStartFile.size > 0) {
      uploadTasks.push(
        uploadGateEvidence(passNo, 'pump-start-0.00', pumpStartFile).then((path) => {
          pumpStartPath = path
        }),
      )
    }

    const pumpStopFile = form.get('pumpStop')
    if (pumpStopFile instanceof File && pumpStopFile.size > 0) {
      uploadTasks.push(
        uploadGateEvidence(passNo, 'pump-stop-amount', pumpStopFile).then((path) => {
          pumpStopPath = path
        }),
      )
    }

    if (uploadTasks.length > 0) {
      await Promise.all(uploadTasks)
    }

    const rawAmount = String(form.get('fuelAmount') ?? '').trim()
    const fuelAmount = rawAmount !== '' && !Number.isNaN(Number(rawAmount)) ? Number(rawAmount) : null

    const rawLitres = String(form.get('fuelLitres') ?? '').trim()
    const fuelLitres = rawLitres !== '' && !Number.isNaN(Number(rawLitres)) ? Number(rawLitres) : null

    const notes = String(form.get('remarks') ?? form.get('notes') ?? '').trim() || null

    const result = await recordGateIn(id, {
      guardName,
      odometer,
      photoPaths,
      signaturePath: null,
      parkedLocation,
      keyHandoverTo,
      notes,
      fuelSlipPath,
      pumpStartPath,
      pumpStopPath,
      fuelAmount,
      fuelLitres,
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
