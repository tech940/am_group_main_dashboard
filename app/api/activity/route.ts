import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { logUserActivity } from '@/lib/activity/user-activity'

export const dynamic = 'force-dynamic'

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const eventType = toText(body?.eventType)
    if (!eventType) {
      return NextResponse.json({ error: 'Event type is required' }, { status: 400 })
    }

    await logUserActivity({
      actor: appUser,
      eventType,
      routePath: toText(body?.routePath) || null,
      routeQuery: toText(body?.routeQuery) || null,
      pageTitle: toText(body?.pageTitle) || null,
      brand: toText(body?.brand) || null,
      module: toText(body?.module) || null,
      sectionKey: toText(body?.sectionKey) || null,
      sessionId: toText(request.headers.get('x-client-session-id')) || null,
      metadata: body?.metadata && typeof body.metadata === 'object'
        ? body.metadata as Record<string, unknown>
        : {},
      request,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/activity failed:', error)
    return NextResponse.json({ error: 'Failed to capture activity' }, { status: 500 })
  }
}
