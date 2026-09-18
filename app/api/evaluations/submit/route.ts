import { after, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { EvaluationSubmitSchema, fieldErrors } from '@/lib/evaluation/types'
import { createVehicleEvaluation, EvaluationError, sendEvaluationAlert } from '@/lib/evaluation/server'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8_000

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * ⚠️ DELIBERATELY PUBLIC — the /sell-used-car page is opened by customers from a WhatsApp campaign, with no
 * login. What protects it instead:
 *   - an 8 KB body cap, read before parsing;
 *   - the same schema the form runs (10-digit mobile, year and date windows, lengths, no control characters);
 *   - a honeypot `website` field that people never see;
 *   - a double-submit guard and a flood ceiling inside the insert statement (lib/evaluation/server.ts);
 *   - escaping of every customer-typed value in the staff alert.
 * It returns only an id — never a stored lead.
 */
export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get('content-length') || 0)
    if (declared > MAX_BODY_BYTES) return json({ error: 'The form is too large to send.' }, 413)
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'The form is too large to send.' }, 413)
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return json({ error: 'The form could not be read. Reload the page and try again.' }, 400)
    }

    // A filled honeypot is a bot: answer as if it worked, store nothing, teach it nothing.
    if (body && typeof body === 'object' && String((body as { website?: unknown }).website ?? '').trim()) {
      return json({ ok: true, id: crypto.randomUUID(), duplicate: false }, 201)
    }

    const input = EvaluationSubmitSchema.parse(body)
    const result = await createVehicleEvaluation(input)
    if (!result.duplicate) {
      after(() =>
        sendEvaluationAlert(input, result.id).catch((error) => {
          console.error('[sell-used-car] alert email failed:', error instanceof Error ? error.message : error)
        }),
      )
    }
    return json({ ok: true, id: result.id, duplicate: result.duplicate }, result.duplicate ? 200 : 201)
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = fieldErrors(error)
      return json({ error: Object.values(errors)[0] ?? 'Check the form.', fieldErrors: errors }, 400)
    }
    if (error instanceof EvaluationError) return json({ error: error.message }, error.status)
    console.error('[sell-used-car] submit failed:', error instanceof Error ? error.message : error)
    return json({ error: 'Something went wrong on our side. Please try again.' }, 500)
  }
}
