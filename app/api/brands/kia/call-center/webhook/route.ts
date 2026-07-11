import { NextResponse } from 'next/server'
import { updateCallStatusFromWebhook } from '@/lib/kia/call-center'

export const dynamic = 'force-dynamic'

// Telephony provider status callback (e.g. Exotel). Public — the provider calls it — so it is gated
// by a shared secret (?secret=...). It only correlates by providerCallId + status; no number reaches us.
export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET
  if (secret && url.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const contentType = request.headers.get('content-type') || ''
    let body: Record<string, unknown> = {}
    if (contentType.includes('application/json')) {
      body = await request.json().catch(() => ({}))
    } else {
      const form = await request.formData().catch(() => null)
      if (form) for (const [key, value] of form.entries()) body[key] = String(value)
    }

    const providerCallId = String(body.CallSid || body.callSid || body.call_id || body.providerCallId || '')
    // Our internal kia_call_logs id, echoed back by the provider (Exotel CustomField).
    const internalCallId = String(body.CustomField || body.customField || body.internalCallId || '')
    const rawStatus = String(body.Status || body.CallStatus || body.status || '').toLowerCase()
    const statusMap: Record<string, string> = {
      'in-progress': 'connected', in_progress: 'connected', connected: 'connected', ringing: 'ringing',
      completed: 'completed', busy: 'no_answer', 'no-answer': 'no_answer', no_answer: 'no_answer',
      failed: 'failed', canceled: 'failed', cancelled: 'failed',
    }
    const status = statusMap[rawStatus] || rawStatus
    const durationSec = Number(body.DialCallDuration || body.ConversationDuration || body.duration || 0)
    const result = await updateCallStatusFromWebhook({ providerCallId, internalCallId, status, durationSec })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Call webhook error:', error)
    // Never return 5xx to the provider (they retry / mark failing endpoints).
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
