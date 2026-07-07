import { NextResponse } from 'next/server'
import { count, desc, eq, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { db } from '@/lib/db'
import { kiaEmailLogs } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// Email delivery log is visible to any admin (super or branch).
async function authorizeAdmin() {
  const actor = await getAuthenticatedAppUser()
  const capabilities = actor ? getAdminCapabilities(actor) : null
  if (!actor || !capabilities) return null
  return actor
}

export async function GET(request: Request) {
  const actor = await authorizeAdmin()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const status = (searchParams.get('status') || 'all').trim()
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '60', 10) || 60))

    const where = status !== 'all' ? eq(kiaEmailLogs.status, status) : undefined

    const [byStatus, rows] = await Promise.all([
      db.select({ status: kiaEmailLogs.status, c: count() }).from(kiaEmailLogs).groupBy(kiaEmailLogs.status),
      db.select().from(kiaEmailLogs).where(where).orderBy(desc(kiaEmailLogs.createdAt)).limit(pageSize),
    ])

    const counts = { pending: 0, sent: 0, failed: 0, total: 0 }
    for (const row of byStatus) {
      const n = Number(row.c || 0)
      counts.total += n
      if (row.status === 'pending') counts.pending = n
      else if (row.status === 'sent') counts.sent = n
      else if (row.status === 'failed') counts.failed = n
    }

    // Failure rate over the last 24h — a quick health signal.
    const [recent] = await db
      .select({
        total: count(),
        failed: sql<number>`count(*) FILTER (WHERE ${kiaEmailLogs.status} = 'failed')`,
      })
      .from(kiaEmailLogs)
      .where(sql`${kiaEmailLogs.createdAt} >= now() - interval '24 hours'`)

    return NextResponse.json({
      counts,
      last24h: { total: Number(recent?.total || 0), failed: Number(recent?.failed || 0) },
      rows,
    })
  } catch (error) {
    console.error('GET /api/admin/email-logs failed:', error)
    return NextResponse.json({ error: 'Failed to load email logs.' }, { status: 500 })
  }
}
