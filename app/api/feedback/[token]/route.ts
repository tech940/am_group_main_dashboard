import { verifyFeedbackToken } from '@/lib/kia/feedback/link'
import { readFeedbackBody, feedbackErrorResponse, feedbackJson } from '@/lib/kia/feedback/api'
import { feedbackSubmitSchema } from '@/lib/kia/feedback/schemas'
import { createWalkInFeedback } from '@/lib/kia/feedback/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = verifyFeedbackToken(token)
  if (!link.ok) return feedbackJson({ error: 'This feedback link is not valid. Please scan the QR code at the showroom desk.' }, 404)

  try {
    const body = await readFeedbackBody(request)
    // Honeypot check
    if (body && typeof body === 'object' && String((body as { website?: unknown }).website ?? '').trim()) {
      return feedbackJson({ ok: true, id: crypto.randomUUID() }, 201)
    }
    const input = feedbackSubmitSchema.parse(body)
    const result = await createWalkInFeedback(link.dealerCode, input)
    return feedbackJson({ ok: true, id: result.id }, 201)
  } catch (error) {
    return feedbackErrorResponse(error)
  }
}
