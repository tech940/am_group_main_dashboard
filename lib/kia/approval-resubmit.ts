import crypto from 'node:crypto'

/**
 * Signed tokens for the "Re-submit" link in the send-back email.
 *
 * ⚠️ WHY A TOKEN AND NOT THE ROW ID.
 *
 * The people who raise vendor payment requests do NOT have dashboard logins — the submit form is
 * public by design. So the re-submit link cannot sit behind a session, which means the link itself
 * is the credential. A bare `?resubmit=<id>` would let anyone walk the id space and read every
 * vendor payment in the system: requester name, vendor, amount, bank details.
 *
 * Same construction as lib/kia/tracking.ts (HMAC over the id, no DB column, nothing to expire in
 * storage). The secret is the app's existing signing secret, so nothing new needs provisioning.
 */

const TOKEN_VERSION = 'v1'

/** Signed links stop working after this, so a forwarded email cannot be replayed indefinitely. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function secret(): string {
  const value = process.env.APPROVAL_LINK_SECRET
    || process.env.TRACKING_LINK_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!value) {
    // Fail loudly rather than signing with a constant: an unsigned-in-practice token would make
    // every vendor payment readable by anyone who guesses an id.
    throw new Error('No signing secret available for approval re-submit links')
  }
  return value
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** `v1.<id>.<issuedAt>.<signature>` — everything needed to verify is in the token. */
export function createResubmitToken(requestId: string, issuedAt: number = Date.now()): string {
  const payload = `${TOKEN_VERSION}.${requestId}.${issuedAt}`
  return `${payload}.${sign(payload)}`
}

export type ResubmitTokenResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifyResubmitToken(token: string | null | undefined): ResubmitTokenResult {
  const raw = String(token ?? '').trim()
  const parts = raw.split('.')
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'malformed' }

  const [, requestId, issuedAtRaw, signature] = parts
  const issuedAt = Number(issuedAtRaw)
  if (!requestId || !Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed' }

  const expected = sign(`${TOKEN_VERSION}.${requestId}.${issuedAtRaw}`)
  // Constant-time compare so the signature cannot be brute-forced a byte at a time.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }

  if (Date.now() - issuedAt > MAX_AGE_MS) return { ok: false, reason: 'expired' }
  return { ok: true, requestId }
}

/**
 * The fields the public re-submit form may see.
 *
 * ⚠️ An allowlist, not a row dump. The token holder is not authenticated, so this must never carry
 * approval history, approver names, internal remarks or payment/UTR details — only what the
 * submitter typed in the first place and now needs to correct.
 */
export const RESUBMIT_VISIBLE_FIELDS = [
  'id', 'email', 'name', 'employeeId', 'location', 'dealerCode', 'dealerName',
  'department', 'specifyOtherDepartment', 'approvalType', 'specifyOtherApprovalType',
  'vendorName', 'previousAdvance', 'amount', 'typeOfPayment', 'remarks',
  // The submitter's own bills, so a send-back doesn't make them re-upload everything they attached.
  'billUrls',
  'uploadDocUrl', 'invoiceNumber', 'invoiceDocUrl', 'brand', 'glAccountId', 'gst', 'vehicleNumber',
] as const

/**
 * Never leave the server on a re-submit fetch: the whole approval chain, every approver's remark,
 * and the payment settlement fields. `sendBackReason` IS shown — the submitter needs to know why.
 */
export const RESUBMIT_HIDDEN_FIELDS = [
  'vpApproval', 'accountApproval', 'hrApproval', 'eaApproval', 'managementApproval',
  'managementRemarks', 'history', 'paymentStatus', 'utrNumber', 'paymentProofUrl',
  'paymentRemarks', 'paymentCompletedAt', 'paymentCompletedBy', 'emailSendStatus',
] as const
