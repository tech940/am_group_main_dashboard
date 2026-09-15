import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Redirected, not deleted. This page was already unreachable — nothing in the sidebar, the search
 * surfaces or the insurance client ever linked to it — and /insurance itself is now a redirect, so
 * leaving it live would keep a guarded page alive that no longer belongs to any section.
 *
 * Its client is retained on disk: the renewal queue it renders is the same primitive the brand books
 * are built on, and is worth folding into them rather than throwing away.
 */
export default async function Page() {
  redirect('/insurance')
}
