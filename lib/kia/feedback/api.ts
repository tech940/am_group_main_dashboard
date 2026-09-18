import 'server-only'

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { fieldErrors } from '../walk-in-leads/schemas'
import { FeedbackError } from './server'

const MAX_BODY_BYTES = 16_000

export async function readFeedbackBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) throw new FeedbackError('The feedback payload is too large.', 413)
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new FeedbackError('The feedback payload is too large.', 413)
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new FeedbackError('The feedback could not be parsed.', 400)
  }
}

export function feedbackJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function feedbackErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const errors = fieldErrors(error)
    return feedbackJson({ error: Object.values(errors)[0] ?? 'Please review your feedback entries.', fieldErrors: errors }, 400)
  }
  if (error instanceof FeedbackError) return feedbackJson({ error: error.message }, error.status)
  console.error('[feedback-api]', error)
  return feedbackJson({ error: 'Failed to record feedback. Please try again.' }, 500)
}
