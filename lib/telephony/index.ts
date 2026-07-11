import 'server-only'

import { env } from '@/config/env-config'

// Masked click-to-call abstraction. A provider bridges the AGENT and the CUSTOMER via a virtual
// number, so neither sees the other's real number. The customer's number is passed here server-side
// only and is NEVER returned to any client. Configure with TELEPHONY_PROVIDER + provider env vars;
// defaults to a simulation so the whole app-side flow works before a real provider is connected.

export type MaskedCallInput = {
  agentPhone: string
  customerPhone: string
  callId: string // our internal kia_call_logs id, for webhook correlation
}
export type MaskedCallStatus = 'initiated' | 'ringing' | 'connected' | 'failed'
export type MaskedCallResult = {
  ok: boolean
  provider: string
  providerCallId: string | null
  status: MaskedCallStatus
  error?: string
}

interface TelephonyProvider {
  name: string
  placeMaskedCall(input: MaskedCallInput): Promise<MaskedCallResult>
}

// Never log the full customer number.
function maskTail(phone: string) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : '••••'
}

// Public base URL the provider uses to reach our status webhook. Must be internet-reachable (prod
// domain or a tunnel) — Exotel can't POST to localhost. Falls back to the app URL.
function publicBaseUrl(): string {
  return String(process.env.TELEPHONY_PUBLIC_BASE_URL || env.app.url || '').replace(/\/$/, '')
}

// The status-callback URL Exotel should POST call progress to (secret-gated). Returns '' when the
// base URL is still localhost, so we never ask a provider to call an unreachable endpoint.
function statusCallbackUrl(): string {
  const base = publicBaseUrl()
  if (!base || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(base)) return ''
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET
  const qs = secret ? `?secret=${encodeURIComponent(secret)}` : ''
  return `${base}/api/brands/kia/call-center/webhook${qs}`
}

// --- Simulation (default) — no real call; proves the app-side masked flow end-to-end. ---
const simulationProvider: TelephonyProvider = {
  name: 'simulation',
  async placeMaskedCall(input) {
    console.log(`[telephony:simulation] bridge agent ${maskTail(input.agentPhone)} ↔ customer ${maskTail(input.customerPhone)} · call ${input.callId}`)
    return { ok: true, provider: 'simulation', providerCallId: `sim-${input.callId}`, status: 'initiated' }
  },
}

// Exotel auth uses an API Key + API Token (distinct from the Account SID, which goes in the URL path).
// Older setups used the SID itself as the key, so fall back to SID/TOKEN for compatibility.
function exotelCreds() {
  const sid = process.env.EXOTEL_SID || ''
  const key = process.env.EXOTEL_API_KEY || sid
  const token = process.env.EXOTEL_API_TOKEN || process.env.EXOTEL_TOKEN || ''
  const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com'
  const callerId = process.env.EXOTEL_CALLER_ID || '' // the Exophone / virtual number both parties see
  return { sid, key, token, subdomain, callerId }
}

// --- Exotel — "Connect two numbers" click-to-call. Exotel dials the agent (From) first, then bridges
// to the customer (To); both legs show the Exophone (CallerId), so number masking is inherent. ---
const exotelProvider: TelephonyProvider = {
  name: 'exotel',
  async placeMaskedCall(input) {
    const { sid, key, token, subdomain, callerId } = exotelCreds()
    if (!sid || !key || !token || !callerId) {
      return { ok: false, provider: 'exotel', providerCallId: null, status: 'failed', error: 'Exotel is not configured' }
    }
    try {
      const params: Record<string, string> = {
        From: input.agentPhone,
        To: input.customerPhone,
        CallerId: callerId,
        CallType: 'trans',
        CustomField: input.callId, // echoed back on the status callback for reliable correlation
      }
      const cb = statusCallbackUrl()
      if (cb) params.StatusCallback = cb
      const res = await fetch(`https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${key}:${token}`).toString('base64')}`,
        },
        body: new URLSearchParams(params).toString(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, provider: 'exotel', providerCallId: null, status: 'failed', error: data?.RestException?.Message || `Exotel HTTP ${res.status}` }
      }
      return { ok: true, provider: 'exotel', providerCallId: data?.Call?.Sid || null, status: 'initiated' }
    } catch (error) {
      return { ok: false, provider: 'exotel', providerCallId: null, status: 'failed', error: error instanceof Error ? error.message : 'Exotel request failed' }
    }
  },
}

function selectProvider(): TelephonyProvider {
  const want = String(process.env.TELEPHONY_PROVIDER || 'simulation').toLowerCase()
  if (want === 'exotel') {
    const { sid, key, token, callerId } = exotelCreds()
    if (sid && key && token && callerId) return exotelProvider
  }
  return simulationProvider
}

export function activeTelephonyProviderName() {
  return selectProvider().name
}

// Diagnostics for the readiness checklist — reports what's configured WITHOUT exposing any secret.
export function telephonyConfigStatus() {
  const want = String(process.env.TELEPHONY_PROVIDER || 'simulation').toLowerCase()
  const { sid, key, token, callerId, subdomain } = exotelCreds()
  const base = publicBaseUrl()
  const webhookReachable = Boolean(statusCallbackUrl())
  return {
    requestedProvider: want,
    activeProvider: selectProvider().name,
    live: selectProvider().name !== 'simulation',
    exotel: {
      hasSid: Boolean(sid),
      hasApiKey: Boolean(key),
      hasApiToken: Boolean(token),
      hasCallerId: Boolean(callerId),
      subdomain,
    },
    webhook: {
      publicBaseUrl: base || null,
      reachable: webhookReachable, // false while base URL is localhost
      secretSet: Boolean(process.env.TELEPHONY_WEBHOOK_SECRET),
    },
  }
}

export async function placeMaskedCall(input: MaskedCallInput): Promise<MaskedCallResult> {
  return selectProvider().placeMaskedCall(input)
}
