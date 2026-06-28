import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { userActivityEvents, users } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const capabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !capabilities) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '25', 10) || 25))
    const search = (searchParams.get('search') || '').trim()
    const eventType = (searchParams.get('eventType') || '').trim()
    const brand = (searchParams.get('brand') || '').trim()
    const dateFrom = (searchParams.get('dateFrom') || '').trim()
    const dateTo = (searchParams.get('dateTo') || '').trim()
    const offset = (page - 1) * pageSize

    const filters = []
    if (eventType) filters.push(eq(userActivityEvents.eventType, eventType))
    if (brand) filters.push(eq(userActivityEvents.brand, brand))
    if (dateFrom) filters.push(gte(userActivityEvents.createdAt, new Date(`${dateFrom}T00:00:00.000Z`)))
    if (dateTo) filters.push(lte(userActivityEvents.createdAt, new Date(`${dateTo}T23:59:59.999Z`)))
    if (search) {
      filters.push(or(
        ilike(users.email, `%${search}%`),
        ilike(users.fullName, `%${search}%`),
        ilike(userActivityEvents.routePath, `%${search}%`),
        ilike(userActivityEvents.eventType, `%${search}%`)
      )!)
    }

    const where = filters.length > 0 ? and(...filters) : undefined

    const [totalRow] = await db
      .select({ total: count() })
      .from(userActivityEvents)
      .leftJoin(users, eq(userActivityEvents.userId, users.id))
      .where(where)

    const rows = await db
      .select({
        id: userActivityEvents.id,
        userId: userActivityEvents.userId,
        supabaseId: userActivityEvents.supabaseId,
        email: sql<string>`COALESCE(${users.email}, ${userActivityEvents.email})`,
        fullName: users.fullName,
        eventType: userActivityEvents.eventType,
        routePath: userActivityEvents.routePath,
        routeQuery: userActivityEvents.routeQuery,
        pageTitle: userActivityEvents.pageTitle,
        brand: userActivityEvents.brand,
        module: userActivityEvents.module,
        sectionKey: userActivityEvents.sectionKey,
        sessionId: userActivityEvents.sessionId,
        ipAddress: userActivityEvents.ipAddress,
        userAgent: userActivityEvents.userAgent,
        metadata: userActivityEvents.metadata,
        createdAt: userActivityEvents.createdAt,
      })
      .from(userActivityEvents)
      .leftJoin(users, eq(userActivityEvents.userId, users.id))
      .where(where)
      .orderBy(desc(userActivityEvents.createdAt))
      .limit(pageSize)
      .offset(offset)

    return NextResponse.json({
      page,
      pageSize,
      total: Number(totalRow?.total || 0),
      rows,
    })
  } catch (error) {
    console.error('GET /api/admin/activity-logs failed:', error)
    return NextResponse.json({ error: 'Failed to load activity logs' }, { status: 500 })
  }
}
