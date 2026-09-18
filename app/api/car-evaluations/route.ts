import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { listEvaluationLeads, parseLeadFilters } from '@/lib/evaluation/read'

export const dynamic = 'force-dynamic'

/**
 * Car Evaluation Leads — the list behind /car-evaluations.
 *
 * ⚠️ Same rule as the page, by the same key: `car_evaluations.view` is grant-only (lib/permissions/registry.ts),
 * so it is true for MD / Developer and for people ticked in the Access Map, and for nobody else — not admin,
 * not hr. Customer names and mobiles are returned in full to those people (owner's choice, 2026-09-18).
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'car_evaluations.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const filters = parseLeadFilters(new URL(request.url).searchParams)
    const result = await listEvaluationLeads(filters)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[car-evaluations] list failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load the leads. Try again.' }, { status: 500 })
  }
}
