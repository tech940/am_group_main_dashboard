import { NextRequest, NextResponse } from 'next/server'
import { GatePassError, recordGateIn, recordGateOut } from '@/lib/gate-pass/server'
import { GatePassUploadError, GATE_PASS_MAX_FILES, uploadGateEvidence } from '@/lib/gate-pass/storage'
import { verifyGateToken } from '@/lib/gate-pass/token'

export const dynamic = 'force-dynamic'
/** Uploads from a phone on a car-park connection. The default 10s is not enough. */
export const maxDuration = 60

/**
 * PUBLIC endpoint — the guard signs a vehicle out or back in. No login, by design.
 *
 * ── Why this cannot be replayed into a fraudulent gate event ──────────────────────────────────
 *   1. The token is HMAC-signed and carries its `purpose`, so an OUT token can never sign a
 *      vehicle back IN — the attack that actually matters, because it would let someone close out
 *      a car that never came back.
 *   2. A token is only ISSUED when its transition becomes possible: OUT at approval, IN at
 *      gate-out. So the approval email cannot express a return.
 *   3. recordGateOut / recordGateIn are compare-and-swap on the status. A replay finds the pass
 *      already moved, writes nothing, and is reported as an idempotent success — a guard whose
 *      phone retried on a flaky connection must not see a failure at a barrier with cars queuing.
 *
 * ⚠️ There is deliberately NO Groq vision check on this path. lib/kia/vehicle-tracker.ts blocks on
 * a Groq round-trip and FAILS CLOSED when GROQ_API_KEY is unset — at a gate that would mean an
 * unset env var or a third-party outage physically stops cars leaving the premises. The burned-in
 * IST timestamp and the immutable audit event are the control here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = verifyGateToken(token, new Date())
  if (!verified.ok) {
    console.warn(`Gate submit rejected: ${verified.reason}`)
    return NextResponse.json({ error: 'This gate pass link is not valid.' }, { status: 404 })
  }

  try {
    const form = await request.formData()

    const guardName = String(form.get('guardName') ?? '').trim()
    if (!guardName) {
      return NextResponse.json({ error: 'Please record the guard name.' }, { status: 400 })
    }

    const rawOdo = String(form.get('odometer') ?? '').trim()
    const odometer = rawOdo === '' ? null : Number(rawOdo)
    if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) {
      return NextResponse.json({ error: 'That odometer reading is not a number.' }, { status: 400 })
    }

    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length > GATE_PASS_MAX_FILES) {
      return NextResponse.json({ error: `At most ${GATE_PASS_MAX_FILES} photos.` }, { status: 413 })
    }
    const kinds = form.getAll('photoKinds').map((k) => String(k))

    // The pass number is needed for the storage path before the row moves, and it is not secret.
    const passNoForPath = String(form.get('passNo') ?? verified.passId).replace(/[^A-Za-z0-9_-]+/g, '')

    const photoPaths: Record<string, string> = {}
    for (let i = 0; i < files.length; i += 1) {
      const kind = kinds[i] || `photo-${i + 1}`
      photoPaths[kind] = await uploadGateEvidence(passNoForPath, kind, files[i])
    }

    const signatureFile = form.get('signature')
    const signaturePath = signatureFile instanceof File && signatureFile.size > 0
      ? await uploadGateEvidence(passNoForPath, 'signature', signatureFile)
      : null

    const licenceFile = form.get('customerLicence')
    const customerLicencePath = licenceFile instanceof File && licenceFile.size > 0
      ? await uploadGateEvidence(passNoForPath, 'customer-licence', licenceFile)
      : null

    const notes = String(form.get('notes') ?? '').trim() || null

    if (verified.purpose === 'out') {
      const result = await recordGateOut(verified.passId, {
        guardName,
        odometer,
        photoPaths,
        signaturePath,
        customerLicencePath,
        notes,
      }, request)
      return NextResponse.json({ ok: true, alreadyDone: result.alreadyDone })
    }

    const result = await recordGateIn(verified.passId, {
      guardName,
      odometer,
      photoPaths,
      signaturePath,
      parkedLocation: String(form.get('parkedLocation') ?? '').trim() || null,
      keyHandoverTo: String(form.get('keyHandoverTo') ?? '').trim() || null,
      notes,
    })
    return NextResponse.json({
      ok: true,
      alreadyDone: result.alreadyDone,
      // Surfaced, not enforced. A lower closing reading is usually a typo, but the vehicle is
      // physically here — refusing the entry would leave it unlogged, which is worse.
      odoWentBackwards: result.odoWentBackwards ?? false,
    })
  } catch (error) {
    if (error instanceof GatePassUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof GatePassError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Gate submit failed:', error)
    return NextResponse.json({ error: 'Could not record that. Please try again.' }, { status: 500 })
  }
}
