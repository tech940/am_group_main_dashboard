import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fuelExceptionReviews } from '@/lib/db/schema'
import { invalidateFuelManagementCache } from '@/lib/fuel-approvals/accountability'
import { guardFuelManagement, NO_STORE, refuse } from '@/lib/fuel-management/api'

export const dynamic = 'force-dynamic'

const OUTCOMES = new Set(['explained', 'data_error', 'follow_up'])
const KEY_PATTERN = /^[a-z_]{3,40}:[A-Za-z0-9:._ -]{1,200}$/
const UUID = /^[0-9a-f-]{36}$/i

/**
 * POST /api/fuel-management/exceptions/review — someone looked at an exception and says what it was.
 *
 * Body: { key, kind, outcome: 'explained' | 'data_error' | 'follow_up', note, fuelApprovalId?, subjectLabel? }
 *
 * The review log is append-only (migration 0071): a second review of the same exception is a new row, and the
 * newest one is what the screen shows. The exception itself is computed, never stored — reviewing it records a
 * judgement about it, not a change to the fuel record. A data error is corrected in Fuel Approvals.
 */
export async function POST(request: NextRequest) {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return refuse(400, 'The review could not be read. Please try again.')

  const key = String(body.key ?? '').trim()
  const kind = String(body.kind ?? '').trim()
  const outcome = String(body.outcome ?? '').trim()
  const note = String(body.note ?? '').trim()
  const fuelApprovalId = String(body.fuelApprovalId ?? '').trim()
  const subjectLabel = String(body.subjectLabel ?? '').trim().slice(0, 160)

  if (!KEY_PATTERN.test(key) || !key.startsWith(`${kind}:`)) return refuse(400, 'That exception reference is not valid.')
  if (!OUTCOMES.has(outcome)) return refuse(400, 'Choose what the review found.')
  if (note.length < 3) return refuse(400, 'Add a short note saying what you found.')
  if (note.length > 600) return refuse(400, 'Keep the note under 600 characters.')

  try {
    const [row] = await db
      .insert(fuelExceptionReviews)
      .values({
        exceptionKey: key,
        kind,
        fuelApprovalId: UUID.test(fuelApprovalId) ? fuelApprovalId : null,
        subjectLabel: subjectLabel || null,
        outcome,
        note,
        actorId: guard.appUser.id,
        actorName: guard.appUser.fullName,
        actorRole: guard.appUser.role,
      })
      .returning({ createdAt: fuelExceptionReviews.createdAt })
    await invalidateFuelManagementCache()
    return NextResponse.json(
      { review: { outcome, note, reviewerName: guard.appUser.fullName, at: row.createdAt.toISOString() } },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('[fuel-management] could not record a review for', key, error)
    return refuse(500, 'The review could not be saved just now. Please try again.')
  }
}
