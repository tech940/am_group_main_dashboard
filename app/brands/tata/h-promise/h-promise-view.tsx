import { Suspense } from 'react'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import type { HPromiseCapabilities } from '@/lib/h-promise/access-shared'
import { getMeta, listVehicles } from '@/lib/h-promise/queries'
import { HPromiseLoading, HPromiseShell } from '@/features/h-promise/hp-app'
import { HPromiseApp } from '@/features/h-promise/hp-home'
import { hpKeys, type HpTab } from '@/features/h-promise/hp-keys'

/**
 * The one H Promise page, shared by /brands/tata/h-promise and the four area links (which only choose the
 * opening tab). Not a route file.
 *
 * ⚠️ The register and the name lists are loaded HERE, on the server, and handed to the client cache: the page
 * arrives with the data, instead of the browser asking for it after hydrating (two more trips to a database
 * ~250 ms away). The header streams first; the app follows once the reads finish. A failed read is left to
 * the client, which asks again and shows the error with a retry.
 */
export function HPromisePage({ caps, initialTab }: { caps: HPromiseCapabilities; initialTab: HpTab | null }) {
  return (
    <HPromiseShell>
      <Suspense fallback={<HPromiseLoading />}>
        <HPromiseData caps={caps} initialTab={initialTab} />
      </Suspense>
    </HPromiseShell>
  )
}

async function HPromiseData({ caps, initialTab }: { caps: HPromiseCapabilities; initialTab: HpTab | null }) {
  const client = new QueryClient()
  const [list, meta] = await Promise.all([
    caps.anyView ? listVehicles('live').catch(() => null) : Promise.resolve(null),
    getMeta().catch(() => null),
  ])
  if (list) client.setQueryData(hpKeys.vehicles('live'), list)
  if (meta) client.setQueryData(hpKeys.meta, meta)
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <HPromiseApp caps={caps} initialTab={initialTab} />
    </HydrationBoundary>
  )
}
