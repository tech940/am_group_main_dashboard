import { requireWalkInApi } from '@/lib/kia/walk-in-leads/access'
import { walkInJson } from '@/lib/kia/walk-in-leads/api'
import { WALK_IN_BRANCHES } from '@/lib/kia/walk-in-leads/constants'
import { walkInFormPath } from '@/lib/kia/walk-in-leads/link'
import { customerFeedbackFormPath } from '@/lib/kia/feedback/link'
import type { WalkInFormLink } from '@/lib/kia/walk-in-leads/types'

export const dynamic = 'force-dynamic'

/**
 * The no-login form link for each branch this person may see. Handing out a link is the "create" right:
 * anyone holding a link can add leads, so a view-only user does not get one.
 */
export async function GET() {
  const access = await requireWalkInApi('create')
  if ('denied' in access) return access.denied
  const links: WalkInFormLink[] = WALK_IN_BRANCHES
    .filter((branch) => !access.viewer.scope || access.viewer.scope.includes(branch.code))
    .map((branch) => ({
      dealerCode: branch.code,
      branch: branch.label,
      path: walkInFormPath(branch.code),
      feedbackPath: customerFeedbackFormPath(branch.code),
    }))
  return walkInJson({ links })
}
