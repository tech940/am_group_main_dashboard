import 'server-only'

import crypto from 'node:crypto'
import { isFeedbackBranchCode } from './constants'
import { isWalkInBranchCode } from '../walk-in-leads/constants'

const VERSION = 'fb1'
const WALK_IN_VERSION = 'wi1'

function secret(): string {
  const value =
    process.env.FEEDBACK_LINK_SECRET ||
    process.env.WALK_IN_LINK_SECRET ||
    process.env.GATE_PASS_TOKEN_SECRET ||
    process.env.APPROVAL_LINK_SECRET ||
    process.env.TRACKING_LINK_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!value) throw new Error('No signing secret available for customer feedback links')
  return value
}

function generation(): string {
  return (process.env.FEEDBACK_LINK_GENERATION || process.env.WALK_IN_LINK_GENERATION || '1').trim() || '1'
}

function sign(version: string, dealerCode: string): string {
  const type = version === WALK_IN_VERSION ? 'walk-in' : 'feedback'
  return crypto
    .createHmac('sha256', secret())
    .update(`${version}|${type}|${dealerCode}|${generation()}`)
    .digest('base64url')
}

export function createFeedbackToken(dealerCode: string): string {
  if (!isFeedbackBranchCode(dealerCode)) throw new Error(`Not a recognized showroom: ${dealerCode}`)
  return `${VERSION}.${dealerCode}.${sign(VERSION, dealerCode)}`
}

export type FeedbackTokenResult = { ok: true; dealerCode: string } | { ok: false }

export function verifyFeedbackToken(token: string | null | undefined): FeedbackTokenResult {
  const parts = String(token ?? '').trim().split('.')
  if (parts.length !== 3) return { ok: false }
  const [version, dealerCode, hash] = parts

  if (version === VERSION) {
    if (!isFeedbackBranchCode(dealerCode)) return { ok: false }
    const expected = sign(VERSION, dealerCode)
    const a = Buffer.from(hash)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false }
    return { ok: true, dealerCode }
  }

  // Backwards compatibility: allow scanning walk-in token on feedback page
  if (version === WALK_IN_VERSION) {
    if (!isWalkInBranchCode(dealerCode)) return { ok: false }
    const expected = sign(WALK_IN_VERSION, dealerCode)
    const a = Buffer.from(hash)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false }
    return { ok: true, dealerCode }
  }

  return { ok: false }
}

export function customerFeedbackFormPath(dealerCode: string): string {
  return `/feedback/${createFeedbackToken(dealerCode)}`
}
