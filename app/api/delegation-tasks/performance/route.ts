import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { delegationTasks } from '@/lib/db/schema'
import { not, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'developer', 'admin'].includes(role)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Fetch all active tasks (excluding cancelled)
    const tasks = await db
      .select({
        id: delegationTasks.id,
        assignedTo: delegationTasks.assignedTo,
        assignedName: delegationTasks.assignedName,
        assignedEmail: delegationTasks.assignedEmail,
        status: delegationTasks.status,
        dueAt: delegationTasks.dueAt,
        completedAt: delegationTasks.completedAt,
      })
      .from(delegationTasks)
      .where(not(eq(delegationTasks.status, 'cancelled')))

    // Group by assignee name/id
    const stats: Record<string, {
      name: string
      email: string
      total: number
      onTime: number
      delayed: number
      onTrack: number
      overdue: number
    }> = {}

    const now = new Date()

    for (const t of tasks) {
      const key = t.assignedTo || t.assignedName || 'Unassigned'
      if (!stats[key]) {
        stats[key] = {
          name: t.assignedName || 'Unassigned',
          email: t.assignedEmail || '',
          total: 0,
          onTime: 0,
          delayed: 0,
          onTrack: 0,
          overdue: 0
        }
      }
      
      const record = stats[key]
      record.total++

      if (t.status === 'done') {
        const completed = t.completedAt ? new Date(t.completedAt) : null
        const due = t.dueAt ? new Date(t.dueAt) : null
        if (completed && due && completed <= due) {
          record.onTime++
        } else {
          record.delayed++
        }
      } else {
        const due = t.dueAt ? new Date(t.dueAt) : null
        if (due && due < now) {
          record.overdue++
        } else {
          record.onTrack++
        }
      }
    }

    const leaderboard = Object.values(stats).map(s => {
      // Calculate marks/score
      const totalPoints = (s.onTime * 100) + (s.delayed * 50) + (s.onTrack * 80) + (s.overdue * 0)
      const score = s.total > 0 ? Math.round(totalPoints / s.total) : 100

      let grade = 'F'
      let color = 'rose'
      if (score >= 90) { grade = 'A+'; color = 'emerald' }
      else if (score >= 80) { grade = 'A'; color = 'teal' }
      else if (score >= 70) { grade = 'B'; color = 'sky' }
      else if (score >= 50) { grade = 'C'; color = 'amber' }

      return {
        ...s,
        score,
        grade,
        color
      }
    })

    // Sort by score descending
    leaderboard.sort((a, b) => b.score - a.score)

    return NextResponse.json({ leaderboard })
  } catch (error) {
    console.error('Failed to get performance stats:', error)
    return NextResponse.json({ error: 'Failed to calculate stats' }, { status: 500 })
  }
}
