import { NextResponse } from 'next/server'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { adminAuditLogs, kiaBookingActivity, kiaBookings, users } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// KIA booking-activity feed — a per-booking history (created, allocated, approved,
// payment confirmed, delivered, …). Surfaced alongside the administrative audit so
// admins have one place to answer "who did what, when" across the KIA lifecycle.
async function readKiaActivity(page: number, pageSize: number, action: string) {
  const where = action ? eq(kiaBookingActivity.activityType, action) : undefined
  const [[totalRow], rows] = await Promise.all([
    db.select({ total: count() }).from(kiaBookingActivity).where(where),
    db
      .select({
        id: kiaBookingActivity.id,
        createdAt: kiaBookingActivity.createdAt,
        activityType: kiaBookingActivity.activityType,
        title: kiaBookingActivity.title,
        description: kiaBookingActivity.description,
        actorName: kiaBookingActivity.actorName,
        actorRole: kiaBookingActivity.actorRole,
        bookingNumber: kiaBookings.bookingNumber,
        customerName: kiaBookings.customerName,
      })
      .from(kiaBookingActivity)
      .leftJoin(kiaBookings, eq(kiaBookingActivity.bookingId, kiaBookings.id))
      .where(where)
      .orderBy(desc(kiaBookingActivity.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])
  const total = Number(totalRow?.total || 0)
  return {
    entries: rows.map((row) => ({
      id: row.id,
      action: row.activityType,
      branch: 'kia' as const,
      reason: [row.title, row.description].filter(Boolean).join(' — ') || null,
      createdAt: row.createdAt,
      actor: row.actorName ? { fullName: row.actorName } : null,
      target: row.customerName
        ? { fullName: `${row.customerName}${row.bookingNumber ? ` · ${row.bookingNumber}` : ''}` }
        : null,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  }
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedAppUser()
    const actorCapabilities = actor ? getAdminCapabilities(actor) : null
    if (!actor || !actorCapabilities) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '30', 10) || 30))
    const action = (searchParams.get('action') || '').trim()
    const source = (searchParams.get('source') || 'admin').trim()

    if (source === 'kia') {
      const kia = await readKiaActivity(page, pageSize, action)
      return NextResponse.json({ actorCapabilities, source: 'kia', ...kia })
    }

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
      source: 'admin',
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
