import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePass, saveFuelProofs } from '@/lib/gate-pass/server'
import { uploadGateEvidence, getGateEvidenceUrl } from '@/lib/gate-pass/storage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    const pass = await getGatePass(access.appUser, id)

    const [fuelSlipUrl, pumpStartUrl, pumpStopUrl] = await Promise.all([
      getGateEvidenceUrl(pass.fuelSlipPath),
      getGateEvidenceUrl(pass.pumpStartPath),
      getGateEvidenceUrl(pass.pumpStopPath),
    ])

    return NextResponse.json({
      passId: pass.id,
      passNo: pass.passNo,
      fuelSlipUrl,
      pumpStartUrl,
      pumpStopUrl,
      fuelAmount: pass.fuelAmount,
      fuelLitres: pass.fuelLitres,
      fuelDocsUploadedAt: pass.fuelDocsUploadedAt,
      isComplete: Boolean(pass.fuelSlipPath && pass.pumpStartPath && pass.pumpStopPath),
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.create')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    const pass = await getGatePass(access.appUser, id)
    const passNo = pass.passNo || id

    const form = await request.formData()

    const fuelSlipFile = form.get('fuelSlip')
    const pumpStartFile = form.get('pumpStart')
    const pumpStopFile = form.get('pumpStop')

    // Upload any new files concurrently in parallel
    const [newSlipPath, newStartPath, newStopPath] = await Promise.all([
      fuelSlipFile instanceof File && fuelSlipFile.size > 0
        ? uploadGateEvidence(passNo, 'fuel-slip', fuelSlipFile)
        : Promise.resolve(null),
      pumpStartFile instanceof File && pumpStartFile.size > 0
        ? uploadGateEvidence(passNo, 'pump-start-0.00', pumpStartFile)
        : Promise.resolve(null),
      pumpStopFile instanceof File && pumpStopFile.size > 0
        ? uploadGateEvidence(passNo, 'pump-stop-amount', pumpStopFile)
        : Promise.resolve(null),
    ])

    const fuelSlipPath = newSlipPath || pass.fuelSlipPath || null
    const pumpStartPath = newStartPath || pass.pumpStartPath || null
    const pumpStopPath = newStopPath || pass.pumpStopPath || null

    if (!fuelSlipPath || !pumpStartPath || !pumpStopPath) {
      return NextResponse.json(
        {
          error: 'All 3 fuel proofs are mandatory: 1. Physical Fuel Slip, 2. Pump Start (0.00), 3. Pump Stop (Amount).',
        },
        { status: 400 },
      )
    }

    const rawAmount = String(form.get('fuelAmount') ?? '').trim()
    const fuelAmount = rawAmount !== '' && !Number.isNaN(Number(rawAmount)) ? Number(rawAmount) : null

    const rawLitres = String(form.get('fuelLitres') ?? '').trim()
    const fuelLitres = rawLitres !== '' && !Number.isNaN(Number(rawLitres)) ? Number(rawLitres) : null

    const updated = await saveFuelProofs(access.appUser, id, {
      fuelSlipPath,
      pumpStartPath,
      pumpStopPath,
      fuelAmount,
      fuelLitres,
    })

    const [fuelSlipUrl, pumpStartUrl, pumpStopUrl] = await Promise.all([
      getGateEvidenceUrl(updated.fuelSlipPath),
      getGateEvidenceUrl(updated.pumpStartPath),
      getGateEvidenceUrl(updated.pumpStopPath),
    ])

    return NextResponse.json({
      ok: true,
      pass: updated,
      fuelDocs: {
        fuelSlipUrl,
        pumpStartUrl,
        pumpStopUrl,
        fuelAmount: updated.fuelAmount,
        fuelLitres: updated.fuelLitres,
        uploadedAt: updated.fuelDocsUploadedAt,
      },
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
