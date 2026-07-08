import { NextResponse } from 'next/server'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { adminAuditLogs, userPermissions, users } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !actorCapabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const scope = actorCapabilities.authority === 'branch_admin'
      ? and(isNull(users.deletedAt), eq(users.brand, actorCapabilities.branch!))
      : isNull(users.deletedAt)

    const [[summary], branchRows, recentActivity, [exceptionRow]] = await Promise.all([
      db.select({
        totalUsers: count(),
        activeUsers: sql<number>`count(*) filter (where ${users.isActive} = true)`,
        inactiveUsers: sql<number>`count(*) filter (where ${users.isActive} = false)`,
        administrators: sql<number>`count(*) filter (where ${users.role} in ('admin', 'developer', 'branch_admin'))`,
        protectedUsers: sql<number>`count(*) filter (where ${users.role} in ('admin', 'developer', 'branch_admin', 'md', 'eba', 'ceo', 'ea', 'accounts', 'purchase_manager', 'finance_head'))`,
      }).from(users).where(scope),
      db.select({
        branch: users.brand,
        total: count(),
        active: sql<number>`count(*) filter (where ${users.isActive} = true)`,
      }).from(users).where(scope).groupBy(users.brand).orderBy(users.brand),
      db.select().from(adminAuditLogs)
        .where(actorCapabilities.authority === 'branch_admin'
          ? eq(adminAuditLogs.branch, actorCapabilities.branch!)
          : undefined)
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(12),
      db.select({ total: count() })
        .from(userPermissions)
        .innerJoin(users, eq(userPermissions.userId, users.id))
        .where(scope),
    ])

    return NextResponse.json({
      actorCapabilities,
      summary: {
        totalUsers: Number(summary?.totalUsers || 0),
        activeUsers: Number(summary?.activeUsers || 0),
        inactiveUsers: Number(summary?.inactiveUsers || 0),
        administrators: Number(summary?.administrators || 0),
        protectedUsers: Number(summary?.protectedUsers || 0),
        permissionExceptions: Number(exceptionRow?.total || 0),
      },
      branches: branchRows.map((row) => ({
        branch: row.branch,
        total: Number(row.total),
        active: Number(row.active),
      })),
      recentActivity,
    })
  } catch (error) {
    console.error('GET /api/admin/overview failed:', error)
    return NextResponse.json({ error: 'Failed to load admin overview.' }, { status: 500 })
  }
}
