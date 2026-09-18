import { requireWalkInApi } from '@/lib/kia/walk-in-leads/access'
import { walkInJson } from '@/lib/kia/walk-in-leads/api'
import { listWalkInFeedback } from '@/lib/kia/feedback/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const access = await requireWalkInApi('view')
  if ('denied' in access) return access.denied

  const url = new URL(request.url)
  const dealer = url.searchParams.get('dealer') || undefined
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined

  const data = await listWalkInFeedback({
    dealerCode: dealer,
    from,
    to,
  })

  return walkInJson(data)
}
