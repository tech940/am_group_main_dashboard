import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { and, eq, isNull, ne, or } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/brands/kia/approvals/migrate-ea-to-md
 *
 * One-time data-repair migration. Fixes records where the MD clicked "Approve"
 * while the request was at the EA stage, causing:
 *   - eaApproval = 'APPROVED'   (set by MD acting on the wrong stage)
 *   - managementApproval = NULL  (MD's actual approval was never recorded)
 *   - The request appears permanently stuck on "Pending MD"
 *
 * Sets managementApproval = 'APPROVED', emailSendStatus = 'MDApproved',
 * and appends a corrective audit history entry.
 *
 * Safe to re-run (idempotent — only touches rows where managementApproval is null/empty).
 * Only callable by MD / CEO / developer / admin.
 */
export async function POST() {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const allowedRoles = ['md', 'ceo', 'developer', 'admin']
    if (!allowedRoles.includes(appUser.role)) {
      return NextResponse.json(
        { error: `Your role (${appUser.role}) cannot run this migration.` },
        { status: 403 }
      )
    }

    // Fetch all candidates:
    //   eaApproval = 'APPROVED'  (set by MD on the wrong stage)
    //   managementApproval IS NULL or ''  (MD's real approval never recorded)
    //   paymentStatus != 'PAID'  (not already completed)
    const candidates = await db
      .select()
      .from(kiaApprovalRequests)
      .where(
        and(
          eq(kiaApprovalRequests.eaApproval, 'APPROVED'),
          or(
            isNull(kiaApprovalRequests.managementApproval),
            eq(kiaApprovalRequests.managementApproval, '')
          ),
          ne(kiaApprovalRequests.paymentStatus, 'PAID')
        )
      )

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        migrated: 0,
        message: 'No stuck records found. Nothing to migrate.',
      })
    }

    let migrated = 0
    const details: Array<{ id: string; eaActorInHistory: string }> = []

    for (const row of candidates) {
      const history = Array.isArray(row.history) ? [...row.history] : []

      // Find who originally set the EA approval (could be MD doing it on wrong stage)
      const eaEntry = history.find(
        (h: any) => h.roleKey === 'ea' && h.action === 'APPROVED'
      )
      const eaActor: string = eaEntry?.user || 'Unknown'

      // Append corrective audit entry
      history.push({
        id: Math.random().toString(36).substring(7),
        role: 'MD',
        roleKey: 'md',
        user: appUser.fullName,
        action: 'APPROVED',
        remarks: `[Data repair] MD approval recorded retroactively. Previously approved at EA stage by ${eaActor} due to a routing bug (now fixed).`,
        timestamp: new Date().toISOString(),
      })

      await db
        .update(kiaApprovalRequests)
        .set({
          managementApproval: 'APPROVED',
          emailSendStatus: 'MDApproved',
          history,
          updatedAt: new Date(),
        })
        .where(eq(kiaApprovalRequests.id, row.id))

      migrated++
      details.push({ id: row.id, eaActorInHistory: eaActor })
    }

    return NextResponse.json({
      success: true,
      migrated,
      message: `Migration complete. ${migrated} record(s) fixed and moved to Pending Accounts.`,
      details,
    })
  } catch (error) {
    console.error('[migrate-ea-to-md] Error:', error)
    return NextResponse.json(
      {
        error: 'Migration failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
