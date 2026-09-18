import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { dispatchDueWalkInFeedbackEmails, getEligibleWalkInFeedbackLeads } from '@/lib/kia/walk-in-leads/feedback-email'

export const dynamic = 'force-dynamic'

function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return true
  }
  const url = new URL(request.url)
  if (cronSecret && url.searchParams.get('secret') === cronSecret) {
    return true
  }
  return false
}

export async function GET(request: Request) {
  // Allow cron or authenticated user
  const cronAuth = isCronAuthorized(request)
  if (!cronAuth) {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const eligible = await getEligibleWalkInFeedbackLeads()
    return NextResponse.json({
      eligibleCount: eligible.length,
      eligible,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch eligible leads' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const cronAuth = isCronAuthorized(request)
  if (!cronAuth) {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const summary = await dispatchDueWalkInFeedbackEmails()
    return NextResponse.json({
      success: true,
      ...summary,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to dispatch feedback emails' },
      { status: 500 },
    )
  }
}
