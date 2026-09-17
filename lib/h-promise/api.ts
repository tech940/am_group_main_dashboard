import 'server-only'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { HPromiseError } from './access'

/**
 * One error translator for every H Promise route.
 *
 * A thrown HPromiseError carries its own status and a sentence for the person. A Zod failure is a 400.
 * The database enforces the owner's safeguards too, so its refusals are translated into the same sentences
 * the app would have given — never a raw constraint name, never a 500 for a rule working as intended.
 * Anything else is ours: a generic 500, with the detail kept in the server log.
 */

type PgLikeError = { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown; cause?: unknown }

/** Drizzle wraps the driver's error; the code sits somewhere down the `cause` chain. */
function pgError(error: unknown): { code: string; constraint: string; message: string } | null {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as PgLikeError
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      const constraint = typeof candidate.constraint_name === 'string'
        ? candidate.constraint_name
        : typeof candidate.constraint === 'string' ? candidate.constraint : ''
      return { code: candidate.code, constraint, message: typeof candidate.message === 'string' ? candidate.message : '' }
    }
    current = candidate.cause
  }
  return null
}

export function hPromiseErrorResponse(error: unknown): NextResponse {
  if (error instanceof HPromiseError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  // storage.ts's upload refusals (checked by name so this module does not load the storage client).
  if (error instanceof Error && error.name === 'HPromiseUploadError' && typeof (error as { status?: unknown }).status === 'number') {
    return NextResponse.json({ error: error.message }, { status: (error as unknown as { status: number }).status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? 'That request is not valid.' }, { status: 400 })
  }

  const pg = pgError(error)
  if (pg) {
    // The price-lock trigger in 0072 raises its own sentence.
    if (pg.code === 'HP001') {
      return NextResponse.json({ error: pg.message.replace(/^H Promise:\s*/, '') }, { status: 409 })
    }
    if (pg.code === '23505') {
      if (pg.constraint.includes('reg_live_key')) {
        return NextResponse.json({ error: 'This registration number is already on the register.' }, { status: 409 })
      }
      if (pg.constraint.includes('one_active')) {
        return NextResponse.json({ error: 'This vehicle already has a live booking.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Someone saved the same thing a moment ago. Refresh and try again.' }, { status: 409 })
    }
    if (pg.code === '23514') {
      if (pg.constraint.includes('not_self')) {
        return NextResponse.json({ error: 'You entered this record, so another approver must decide it.' }, { status: 403 })
      }
      console.error('[h-promise] check constraint refused a write:', pg.constraint, error)
      return NextResponse.json({ error: 'Some of the values are not allowed. Check the form and try again.' }, { status: 400 })
    }
    if (pg.code === '23503') {
      return NextResponse.json({ error: 'That record no longer exists. Refresh and try again.' }, { status: 409 })
    }
  }

  console.error('[h-promise] request failed:', error)
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}

/** Every H Promise response carries buyers' and sellers' details: never cached by a browser or a proxy. */
export function hpJson(data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/** The request body as JSON, or a 400 with a sentence. An empty body reads as `{}`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}
  if (text.length > 100_000) throw new HPromiseError('That request is too large.', 413)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HPromiseError('That request is not valid.', 400)
  }
}
