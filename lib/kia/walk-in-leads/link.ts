import 'server-only'

import crypto from 'node:crypto'
import { isWalkInBranchCode } from './constants'

/**
 * The no-login Walk-in form link: `/walk-in/wi1.<JK402|JK501|JK502>.<signature>`.
 *
 * One stable link per KIA branch, meant to be printed as a QR code at the showroom desk, so it does not
 * expire. It is signed, so nobody can invent a link or switch branches by editing it, and it names only the
 * branch — nothing about any customer.
 *
 * ⚠️ ROTATING A LEAKED LINK: set WALK_IN_LINK_GENERATION to a new value (default "1"). Every existing link
 * then stops working at once, and the section's "Form links" dialog hands out the new ones.
 *
 * WALK_IN_LINK_SECRET is the secret to set. The fallback chain (the same one the gate-pass links use) keeps
 * the form working in environments already provisioned for this app; rotating any of those secrets would
 * also retire the walk-in links.
 */
const VERSION = 'wi1'

function secret(): string {
  const value = process.env.WALK_IN_LINK_SECRET
    || process.env.GATE_PASS_TOKEN_SECRET
    || process.env.APPROVAL_LINK_SECRET
    || process.env.TRACKING_LINK_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!value) throw new Error('No signing secret available for walk-in form links')
  return value
}

function generation(): string {
  return (process.env.WALK_IN_LINK_GENERATION || '1').trim() || '1'
}

function sign(dealerCode: string): string {
  return crypto.createHmac('sha256', secret()).update(`${VERSION}|walk-in|${dealerCode}|${generation()}`).digest('base64url')
}

export function createWalkInToken(dealerCode: string): string {
  if (!isWalkInBranchCode(dealerCode)) throw new Error(`Not a walk-in showroom: ${dealerCode}`)
  return `${VERSION}.${dealerCode}.${sign(dealerCode)}`
}

export type WalkInTokenResult = { ok: true; dealerCode: string } | { ok: false }

export function verifyWalkInToken(token: string | null | undefined): WalkInTokenResult {
  const parts = String(token ?? '').trim().split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false }
  const dealerCode = parts[1]
  if (!isWalkInBranchCode(dealerCode)) return { ok: false }
  const a = Buffer.from(parts[2])
  const b = Buffer.from(sign(dealerCode))
  // Constant time; lengths first, because timingSafeEqual throws on a mismatch.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false }
  return { ok: true, dealerCode }
}

export function walkInFormPath(dealerCode: string): string {
  return `/walk-in/${createWalkInToken(dealerCode)}`
}
