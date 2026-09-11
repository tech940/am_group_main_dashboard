import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import {
  TRACKER_NOTE_MAX_LENGTH,
  TrackerMappingError,
  getTrackerBoard,
  linkTracker,
  moveTracker,
  trackerActorFor,
  unlinkTracker,
} from '@/lib/loconav/mappings'

export const dynamic = 'force-dynamic'

/**
 * The Trackers screen: which LocoNav tracker is fitted to which demo car.
 *
 *   GET  — the board (TrackerBoardResponse in lib/loconav/mappings.ts).
 *   POST — `{ action: 'link' | 'unlink', providerVehicleUuid, vin, note? }`
 *          or `{ action: 'move', providerVehicleUuid, fromVin, toVin, note? }` → `{ ok: true, alreadyDone?: true }`.
 *
 * ⚠️ 'gate_pass.approve' ON GET TOO. requireGatePassAccess admits EVERY signed-in employee for view/create
 * (access.ts), and this board lists provider uuids, plates and which car carries which tracker. The page
 * decides whether to show the panel with checkGatePassPermission — the resolution requireGatePassAccess
 * uses — so the two cannot disagree about who sees it.
 *
 * ⚠️ The permission is only half the check on POST. mappings.ts also tests the car's branch against the
 * actor's dealer pin and answers 403 outside it: "you are an approver" is not "of this car's branch". A move
 * is tested against BOTH cars' branches.
 *
 * Postgres only. Nothing here calls LocoNav, and nothing here returns coordinates, positions, device phone
 * numbers or full device serials.
 */
export async function GET(_request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.approve')
  if (access.denied) return access.denied

  try {
    const board = await getTrackerBoard(trackerActorFor(access.appUser))
    return NextResponse.json(board)
  } catch (error) {
    return mappingErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.approve')
  if (access.denied) return access.denied

  try {
    // A JSON `null` or array parses fine and would throw on the first property read, so narrow to an object.
    const raw: unknown = await request.json().catch(() => ({}))
    const body = (raw && typeof raw === 'object' ? raw : {}) as {
      action?: unknown
      providerVehicleUuid?: unknown
      vin?: unknown
      fromVin?: unknown
      toVin?: unknown
      note?: unknown
    }

    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
    if (action !== 'link' && action !== 'unlink' && action !== 'move') {
      return NextResponse.json({ error: 'Action must be link, unlink or move.' }, { status: 400 })
    }
    const providerVehicleUuid = typeof body.providerVehicleUuid === 'string' ? body.providerVehicleUuid.trim() : ''
    if (!providerVehicleUuid) {
      return NextResponse.json({ error: 'Choose a tracker.' }, { status: 400 })
    }
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return NextResponse.json({ error: 'The note must be text.' }, { status: 400 })
    }
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (note.length > TRACKER_NOTE_MAX_LENGTH) {
      return NextResponse.json({ error: `The note can be at most ${TRACKER_NOTE_MAX_LENGTH} characters.` }, { status: 400 })
    }

    // ⚠️ Built from the signed-in user, so the actor id is never null here — null is the system actor, which skips the branch check.
    const actor = trackerActorFor(access.appUser)

    if (action === 'move') {
      const fromVin = typeof body.fromVin === 'string' ? body.fromVin.trim() : ''
      if (!fromVin) {
        return NextResponse.json({ error: 'Say which car the tracker is linked to now.' }, { status: 400 })
      }
      const toVin = typeof body.toVin === 'string' ? body.toVin.trim() : ''
      if (!toVin) {
        return NextResponse.json({ error: 'Choose the car to move the tracker to.' }, { status: 400 })
      }
      return NextResponse.json(await moveTracker({ providerVehicleUuid, fromVin, toVin, note: note || null, actor }))
    }

    const vin = typeof body.vin === 'string' ? body.vin.trim() : ''
    if (!vin) {
      return NextResponse.json({ error: 'Choose a car.' }, { status: 400 })
    }
    const input = { providerVehicleUuid, vin, note: note || null, actor }
    const result = action === 'link' ? await linkTracker(input) : await unlinkTracker(input)
    return NextResponse.json(result)
  } catch (error) {
    return mappingErrorResponse(error)
  }
}

/** A TrackerMappingError already carries its status; everything else goes through the shared translator. */
function mappingErrorResponse(error: unknown): NextResponse {
  if (error instanceof TrackerMappingError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  return gatePassErrorResponse(error)
}
