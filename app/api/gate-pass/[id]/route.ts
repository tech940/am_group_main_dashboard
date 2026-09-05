import { NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePass } from '@/lib/gate-pass/server'
import { readGatePassEvents } from '@/lib/gate-pass/events'
import { gatePassMetrics } from '@/lib/gate-pass/metrics'
import { getGateEvidenceUrl, signEvidenceMap } from '@/lib/gate-pass/storage'

export const dynamic = 'force-dynamic'
/** Signing a handful of storage URLs is several round trips. */
export const maxDuration = 60

/**
 * One pass, in full: the record, its computed timings, its evidence, and its audit trail.
 *
 * ⚠️ Photo PATHS never leave the server — they are exchanged for short-lived signed URLs here.
 * The bucket is private, so a raw path would be useless to a browser anyway; returning one would
 * only leak the storage layout and tempt a future caller into building a public URL from it.
 *
 * ⚠️ Next 16: `params` is a Promise and must be awaited.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    // getGatePass enforces the dealer scope itself — the permission alone would hand a Udhampur
    // user a Jammu pass.
    const pass = await getGatePass(access.appUser, id)
    const events = await readGatePassEvents(id)

    const [outPhotos, inPhotos, outSignature, inSignature] = await Promise.all([
      signEvidenceMap(pass.gateOutPhotoPaths as Record<string, string> | null),
      signEvidenceMap(pass.gateInPhotoPaths as Record<string, string> | null),
      getGateEvidenceUrl(pass.gateOutSignaturePath),
      getGateEvidenceUrl(pass.gateInSignaturePath),
    ])

    return NextResponse.json({
      pass,
      // Computed server-side from the shared definitions, so the detail view, the KPI strip and the
      // CSV cannot disagree about what "late" or "distance" means.
      metrics: gatePassMetrics(pass),
      evidence: { outPhotos, inPhotos, outSignature, inSignature },
      events,
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
