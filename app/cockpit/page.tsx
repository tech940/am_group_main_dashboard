import { after } from 'next/server'
import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getGroupCockpit } from '@/lib/cockpit/cockpit-data'
import { MainLayout } from '@/components/layout/main-layout'
import { CockpitDashboard } from '@/features/cockpit/cockpit-dashboard'
import { IndiaSnapshotSection } from '@/features/cockpit/india-snapshot-section'

export const metadata = {
  title: 'Group Cockpit | AM Group',
  description: 'Executive cross-brand cockpit: group service revenue, approved cash, and KIA sales & stock, month-to-date.',
}

export default async function CockpitPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const permission = await requirePermission(appUser, 'cockpit.view')
  if (!permission.allowed) forbidden()

  /*
   * ── WARM THE CACHE WHILE THE SHELL IS BEING DELIVERED ──────────────────────────────────────
   *
   * The client fetches /api/cockpit on mount, so a cold cache means the user watches a spinner for
   * the whole build. The cache key contains the anchor DATE, so it turns over every midnight: the
   * first person to open the cockpit each morning always paid full price, with no stale entry to
   * fall back on. That is the worst case and it happens daily.
   *
   * Starting the build here overlaps it with HTML delivery and hydration instead. The work is
   * deduped downstream — getCachedData single-flights concurrent callers and publishes to Redis —
   * so this races the client's own request rather than duplicating it.
   *
   * ⚠️ `after()`, not a bare floating promise. On serverless the invocation is frozen once the
   * response is sent, which kills unpinned background work; after() holds it open via waitUntil.
   * The .catch is required — an unhandled rejection here would fail the page render, and a warm-up
   * that can break the page it is warming is worse than no warm-up.
   */
  after(getGroupCockpit({ endDate: null }).catch(() => null))

  return (
    <MainLayout title="Group Cockpit" subtitle="Cross-brand executive overview — month to date">
      <div className="space-y-8">
        <CockpitDashboard />
        {/*
          * The daily India report, below the month-to-date cockpit. Its own component with its own
          * query, so a slow or failed snapshot never delays or breaks the cockpit above it — and the
          * reverse. They share only the page and the cockpit.view permission.
          */}
        <IndiaSnapshotSection />
      </div>
    </MainLayout>
  )
}
