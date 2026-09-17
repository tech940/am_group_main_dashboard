import { requireAnyHPromiseArea } from '@/lib/h-promise/access'
import { isHpTab } from '@/features/h-promise/hp-keys'
import { HPromisePage } from './h-promise-view'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'H Promise | AM Tata',
  description: 'AM Tata pre-owned cars: purchase, booking, sale, documents, approvals, payment verification and MIS.',
}

/*
 * AM Tata · H Promise — the one page behind the one sidebar link. It opens for anyone holding any of the four
 * H Promise sections (lib/h-promise/access.ts#requireAnyHPromiseArea); the page shows only the tabs they hold.
 * `?tab=approvals` (etc.) chooses the opening tab.
 */
export default async function HPromiseIndexPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { caps } = await requireAnyHPromiseArea()
  const tab = (await searchParams).tab
  return <HPromisePage caps={caps} initialTab={isHpTab(tab) ? tab : null} />
}
