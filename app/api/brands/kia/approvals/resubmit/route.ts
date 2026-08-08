import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import {
  RESUBMIT_VISIBLE_FIELDS,
  verifyResubmitToken,
} from '@/lib/kia/approval-resubmit'

/**
 * Hydrates the public submit form for a "Re-submit" link from a send-back email.
 *
 * ⚠️ DELIBERATELY UNAUTHENTICATED, like the rest of the intake path — the people who raise vendor
 * payment requests have no dashboard login. The SIGNED TOKEN is the credential here, not a session.
 * A bare row id would expose every vendor payment to anyone who guessed one.
 *
 * Only returns a field allowlist. The approval chain, approver remarks and payment/UTR details are
 * never sent, because the caller is not authenticated — they have proved they hold the link, which
 * is not the same as being entitled to see who approved what.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const verified = verifyResubmitToken(token)

  if (!verified.ok) {
    // Distinguish expired from invalid so the form can say something useful, but never confirm
    // whether a request id exists.
    const message = verified.reason === 'expired'
      ? 'This re-submit link has expired. Please ask for the request to be sent back again.'
      : 'This re-submit link is not valid.'
    return NextResponse.json({ error: message, reason: verified.reason }, { status: 400 })
  }

  try {
    const [row] = await db
      .select()
      .from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.id, verified.requestId))
      .limit(1)

    if (!row) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })

    // Only a request that was actually sent back may be reopened. Without this a valid old token
    // would let someone edit a request that has since been approved or already paid.
    if (row.emailSendStatus !== 'SentBack') {
      return NextResponse.json({
        error: 'This request is no longer awaiting re-submission. It may have already been re-submitted or actioned.',
        reason: 'not_sent_back',
      }, { status: 409 })
    }

    const source = row as unknown as Record<string, unknown>
    const prefill: Record<string, unknown> = {}
    for (const field of RESUBMIT_VISIBLE_FIELDS) {
      if (source[field] !== undefined) prefill[field] = source[field]
    }

    return NextResponse.json({
      prefill,
      // Shown at the top of the form so the submitter can see what they are correcting.
      sendBackReason: row.sendBackReason ?? null,
    })
  } catch (error) {
    console.error('[kia/approvals/resubmit] failed', error)
    return NextResponse.json({ error: 'Failed to load the request.' }, { status: 500 })
  }
}
