import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'
import { refreshGroupCockpit } from '@/lib/cockpit/cockpit-data'
import { refreshIndiaSnapshot } from '@/lib/cockpit/india-snapshot'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Scheduled warmer for the Group Cockpit (vercel.json, every 10 minutes 07:30–21:30 IST). Builds today's
 * India snapshot and cockpit off the request path and stores them, so the MD opens a built page instead of
 * paying for a cold build (7–9s, two queries at a time — see CONCURRENCY in lib/cockpit/cockpit-data.ts).
 *
 * One after the other, never together: the pooler is the constraint (the cockpit already runs two queries
 * at a time, and the India snapshot three).
 * A build with a section missing is NOT stored; the last complete one keeps being served.
 *
 * Auth fails closed (lib/maintenance/cron-auth.ts): `Authorization: Bearer $CRON_SECRET` from Vercel Cron,
 * or `?secret=$COCKPIT_REFRESH_SECRET` for a manual run.
 */
async function handleRefresh(request: Request) {
  const url = new URL(request.url)
  const auth = authorizeCronRequest(request, url, {
    secret: process.env.COCKPIT_REFRESH_SECRET,
    secretEnvName: 'COCKPIT_REFRESH_SECRET',
  })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const started = Date.now()
  try {
    const india = await refreshIndiaSnapshot()
    const cockpit = await refreshGroupCockpit()
    return NextResponse.json({ ok: true, india, cockpit, ms: Date.now() - started })
  } catch (error) {
    console.error('Cockpit refresh failed:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  return handleRefresh(request)
}

export async function POST(request: Request) {
  return handleRefresh(request)
}
