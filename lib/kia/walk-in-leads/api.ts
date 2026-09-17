import 'server-only'

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { fieldErrors } from './schemas'
import { WalkInError } from './server'

const MAX_BODY_BYTES = 16_000

/** Reads a small JSON body. The form sends a few kilobytes at most, so anything bigger is refused unread. */
export async function readWalkInBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) throw new WalkInError('The form is too large to send.', 413)
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new WalkInError('The form is too large to send.', 413)
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new WalkInError('The form could not be read. Reload the page and try again.', 400)
  }
}

export function walkInJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function walkInErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const errors = fieldErrors(error)
    return walkInJson({ error: Object.values(errors)[0] ?? 'Check the form.', fieldErrors: errors }, 400)
  }
  if (error instanceof WalkInError) return walkInJson({ error: error.message }, error.status)
  console.error('[walk-in-leads]', error)
  return walkInJson({ error: 'Something went wrong. Try again.' }, 500)
}
