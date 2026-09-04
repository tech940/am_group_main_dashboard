import crypto from 'node:crypto'

/**
 * Signed tokens for the guard's QR code.
 *
 * ── Why the token IS the credential ───────────────────────────────────────────────────────────
 * Security guards have no dashboard accounts, by decision. So the QR cannot sit behind a session,
 * which means the link itself authorises the action — the same position the public re-submit link
 * and the customer tracking link are already in (lib/kia/approval-resubmit.ts, lib/kia/tracking.ts),
 * and this is built the same way: HMAC-SHA256 over a dot-joined payload, nothing stored, nothing to
 * expire in the database.
 *
 * A bare /gate/<passId> would let anyone walk the id space and read who is driving what, where, and
 * when — and then record a false return on any of it.
 *
 * ── ONE TOKEN PER TRANSITION. This is the whole security design. ──────────────────────────────
 * The token carries a `purpose`, and a token is only ISSUED when its transition becomes possible:
 *
 *   approved  ->  the OUT token is issued (in the approval email and on the pass)
 *   out       ->  the IN token is issued (on the gate-out confirmation, and emailed to the requester)
 *
 * So a screenshot of the approval QR can perform exactly one thing — the gate-out that was going to
 * happen anyway — and can never record the vehicle's return. That last part is the attack that
 * actually matters: a leaked pass that could sign a car back in would let someone close out a
 * vehicle that never came back.
 *
 * Three further limits, each independent of the HMAC:
 *   1. `purpose` is inside the signed payload, so an OUT token cannot be replayed as an IN token.
 *   2. The server re-checks the pass status before acting. Transitions are strictly one-way
 *      (approved -> out -> returned), so a replayed token finds the pass already moved and writes
 *      nothing — reported as an idempotent success, not an error.
 *   3. A TTL bound to the trip window, not a flat 30 days like a re-submit link.
 *
 * That combination is why there is no epoch column and no single-use nonce table: with one token per
 * transition and a one-way state machine, a replay has nothing left to do. Both would be real
 * additions if a token could ever authorise the same transition twice. It cannot.
 */

const TOKEN_VERSION = 'g1'

export type GateTokenPurpose = 'out' | 'in'

/**
 * How long a gate token stays usable after the trip was due back.
 *
 * Generous on purpose. A car returning late is the normal case, and a guard holding a dead QR at
 * 11pm has no way to record anything and no one to call — so the pass would go unlogged, which is
 * worse than a slightly wider window on a credential that can only ever perform one one-way step.
 */
const GRACE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * ⚠️ A dedicated secret first.
 *
 * The chain that follows exists so the feature works in environments already provisioned for this
 * app, but GATE_PASS_TOKEN_SECRET is the one to set: a gate credential must be rotatable on its own.
 * Falling back to SUPABASE_SERVICE_ROLE_KEY means rotating a leaked gate link forces rotation of the
 * database's root key, which nobody will do, so in practice it would never be rotated at all.
 */
function secret(): string {
  const value = process.env.GATE_PASS_TOKEN_SECRET
    || process.env.APPROVAL_LINK_SECRET
    || process.env.TRACKING_LINK_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!value) {
    // Fail loudly rather than signing with a constant. An unsigned-in-practice token would let
    // anyone open any pass and sign any vehicle in or out.
    throw new Error('No signing secret available for gate pass tokens')
  }
  return value
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** `g1.<passId>.<purpose>.<issuedAt>.<expiresAt>.<signature>` — self-contained, nothing stored. */
export function createGateToken(params: {
  passId: string
  purpose: GateTokenPurpose
  /** When the trip is due back. The token dies a week after this. */
  expectedReturnAt: Date
  issuedAt: Date
}): string {
  const issued = params.issuedAt.getTime()
  const expires = params.expectedReturnAt.getTime() + GRACE_MS
  const payload = `${TOKEN_VERSION}.${params.passId}.${params.purpose}.${issued}.${expires}`
  return `${payload}.${sign(payload)}`
}

export type GateTokenResult =
  | { ok: true; passId: string; purpose: GateTokenPurpose }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

/**
 * `now` is injected rather than read from the clock so the expiry branch is testable, and so a
 * caller cannot accidentally verify against a different clock than it logs with.
 */
export function verifyGateToken(token: string | null | undefined, now: Date): GateTokenResult {
  const raw = String(token ?? '').trim()
  const parts = raw.split('.')
  if (parts.length !== 6 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'malformed' }

  const [, passId, purpose, issuedRaw, expiresRaw, signature] = parts
  const expires = Number(expiresRaw)
  if (!passId || !Number.isFinite(Number(issuedRaw)) || !Number.isFinite(expires)) {
    return { ok: false, reason: 'malformed' }
  }
  if (purpose !== 'out' && purpose !== 'in') return { ok: false, reason: 'malformed' }

  const expected = sign(`${TOKEN_VERSION}.${passId}.${purpose}.${issuedRaw}.${expiresRaw}`)
  // Constant-time, so the signature cannot be brute-forced a byte at a time. Compare lengths first:
  // timingSafeEqual throws on a length mismatch rather than returning false.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }

  if (now.getTime() > expires) return { ok: false, reason: 'expired' }
  return { ok: true, passId, purpose }
}

/** The URL that goes into the QR. A plain https link, so a phone's own camera app opens it. */
export function buildGateUrl(baseUrl: string, token: string): string {
  return `${String(baseUrl).replace(/\/+$/, '')}/gate/${encodeURIComponent(token)}`
}

/**
 * What the unauthenticated guard page may show.
 *
 * ⚠️ An allowlist, not a row dump — the same posture as RESUBMIT_VISIBLE_FIELDS. The person holding
 * this link is not authenticated and is not our employee. They need to confirm that the car in front
 * of them is the car on the pass, and nothing else.
 *
 * The full licence number is absent deliberately: the guard checks the physical licence against the
 * driver's face and the masked last four, which is what a gate check actually is. Shipping the whole
 * number would put a government ID on an unauthenticated page reachable by anyone the link reaches.
 */
export const GATE_VISIBLE_FIELDS = [
  'passNo', 'status', 'registrationNumber', 'model', 'variant', 'color', 'keyNumber',
  'driverName', 'driverLicenceMasked', 'driverLicenceValid',
  'purpose', 'purposeNote', 'expectedReturnAt',
  'approvedByName', 'approvedAt', 'branchLabel',
  // Present only on the gate-in view, so the guard can sanity-check the closing reading.
  'gateOutAt', 'gateOutOdo',
] as const

/**
 * Never reaches the guard page. Customer contact details, the requester's identity, anything
 * commercial, and every internal remark — none of which a gate check needs, all of which a leaked
 * link would otherwise hand to a stranger.
 */
export const GATE_HIDDEN_FIELDS = [
  'driverLicenceNo', 'driverPhone', 'requestedByEmail', 'requestedBy', 'remarks',
  'approvalRemarks', 'gateInRemarks', 'department', 'vin',
] as const
