import 'server-only'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { GatePassError } from './server'

/**
 * One error translator for every gate pass route.
 *
 * Written once because the alternative — each route mapping its own errors — is how this repo ended
 * up with routes that substring-match error MESSAGES to pick a status code. A thrown
 * GatePassError already carries its status; a Zod failure is always a 400; anything else is ours
 * and is a 500 with the detail kept server-side.
 */
export function gatePassErrorResponse(error: unknown): NextResponse {
  if (error instanceof GatePassError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? 'That request is not valid.' },
      { status: 400 },
    )
  }
  // Never leak an internal message to the client — but always keep it in the server log.
  console.error('Gate pass request failed:', error)
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}
