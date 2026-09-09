import { NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePass } from '@/lib/gate-pass/server'
import { readGatePassEvents } from '@/lib/gate-pass/events'
import { gatePassMetrics } from '@/lib/gate-pass/metrics'
import { getGateEvidenceUrl, signEvidenceMap } from '@/lib/gate-pass/storage'
import { getTripForPass } from '@/lib/loconav/trips'

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
    const canSeeRoute = !(await requireGatePassAccess('gate_pass.approve')).denied
    const events = await readGatePassEvents(id)

    /*
     * The provider's account of the same drive, when there is one. Postgres only, and it returns
     * null rather than throwing if migration 0058 has not been applied — a pass detail must not go
     * down because an optional integration is half-deployed.
     */
    const [trip, [outPhotos, inPhotos, outSignature, inSignature]] = await Promise.all([
      getTripForPass(id),
      Promise.all([
      signEvidenceMap(pass.gateOutPhotoPaths as Record<string, string> | null),
      signEvidenceMap(pass.gateInPhotoPaths as Record<string, string> | null),
      getGateEvidenceUrl(pass.gateOutSignaturePath),
      getGateEvidenceUrl(pass.gateInSignaturePath),
      ]),
    ])

    return NextResponse.json({
      pass,
      // Computed server-side from the shared definitions, so the detail view, the KPI strip and the
      // CSV cannot disagree about what "late" or "distance" means.
      metrics: gatePassMetrics(pass),
      evidence: { outPhotos, inPhotos, outSignature, inSignature },
      /*
       * ⚠️ null means "no reconciliation row", which is NOT the same as "no discrepancy" — it can
       * equally mean the sweep has not run yet or the car has no tracker. The client must say which
       * rather than rendering an empty space that reads as "all fine".
       */
      /*
       * ⚠️ REDACTED FOR NON-APPROVERS, exactly as the fleet route redacts live coordinates.
       * `timeline` holds encoded polylines and street addresses for the whole drive, and `alerts`
       * their locations — that is a minute-by-minute record of where a named customer went on a test
       * drive. requireGatePassAccess lets EVERY authenticated employee through for 'view'
       * (access.ts:120-123), so shipping it unredacted would put that in front of the whole company.
       *
       * Everyone still gets the two DISTANCES and the discrepancy flag, which is what makes the
       * reconciliation useful; only the route itself is held back.
       */
      trip: trip && !canSeeRoute ? { ...trip, timeline: [], alerts: [] } : trip,
      events,
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
