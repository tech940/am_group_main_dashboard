import { redirect } from 'next/navigation'

/*
 * /petty-cash/status is retired — its content now lives in the workspace.
 *
 * It was a THIRD petty-cash surface: a standalone board with its own title ("Petty Cash · Status"),
 * its own status vocabulary and its own delete guard, rendering the same requests as the queue.
 * Nothing in the app linked to it, and it was a `'use client'` page with NO permission gate at all —
 * unlike /petty-cash, which checks canAccessPettyCash AND the Access-Map deny override.
 *
 * A redirect rather than a deletion so existing bookmarks still land somewhere useful, and so the
 * destination carries the permission checks this page never had. Everything it showed is in the
 * Approvals tab now: the stage and pending approver are in the Status pill ("Waiting on MD"), and
 * "time waiting" is the Waiting column.
 */
export default function PettyCashStatusPage() {
  redirect('/petty-cash')
}
