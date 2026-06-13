import { NextResponse } from 'next/server'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { adminAuditLogs, users } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !actorCapabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '30', 10) || 30))
    const action = (searchParams.get('action') || '').trim()
    const conditions = []
    if (actorCapabilities.authority === 'branch_admin') {
      conditions.push(eq(adminAuditLogs.branch, actorCapabilities.branch!))
    }
    if (action) conditions.push(eq(adminAuditLogs.action, action))
    const where = conditions.length ? and(...conditions) : undefined

    const [[totalRow], rows] = await Promise.all([
      db.select({ total: count() }).from(adminAuditLogs).where(where),
      db.select().from(adminAuditLogs)
        .where(where)
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ])

    const userIds = Array.from(new Set(rows.flatMap((row) =>
      [row.actorUserId, row.targetUserId].filter((value): value is string => Boolean(value))
    )))
    const userRows = userIds.length
      ? await db.select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds))
      : []
    const userById = new Map(userRows.map((user) => [user.id, user]))
    const total = Number(totalRow?.total || 0)

    return NextResponse.json({
      actorCapabilities,
      entries: rows.map((row) => ({
        ...row,
        actor: row.actorUserId ? userById.get(row.actorUserId) || null : null,
        target: row.targetUserId ? userById.get(row.targetUserId) || null : null,
      })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('GET /api/admin/audit failed:', error)
    return NextResponse.json({ error: 'Failed to load audit history.' }, { status: 500 })
  }
}
