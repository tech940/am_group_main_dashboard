import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { MD_APPROVAL_SOURCES, isMdApprovalSourceId, summarise } from '@/lib/md-approvals/sources'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * One source's MD queue: every row in its MD workflow, each marked `awaitingMd`.
 *
 * Returns BOTH scopes in one payload rather than re-querying on toggle — the row counts are small
 * (tens, not thousands) and it keeps the "Needs my approval" / "All" switch instant.
 *
 * Gated on a hardcoded super-admin check, deliberately NOT a permission-registry key, so it cannot
 * be widened from the Access Map. Same predicate as the page and the action route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ source: string }> }) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperAdminRole(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { source: sourceId } = await params
  if (!isMdApprovalSourceId(sourceId)) {
    return NextResponse.json({ error: `Unknown approval source '${sourceId}'` }, { status: 404 })
  }

  const source = MD_APPROVAL_SOURCES[sourceId]
  try {
    const list = await source.read()
    return NextResponse.json({
      source: {
        id: source.id, label: source.label, href: source.href,
        amountKind: source.amountKind, supportsHold: source.supportsHold,
      },
      summary: summarise(source, list),
      rows: list,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the approval queue' },
      { status: 500 },
    )
  }
}
