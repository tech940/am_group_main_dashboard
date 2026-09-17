import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson, readJsonBody } from '@/lib/h-promise/api'
import { listExchangeBonuses } from '@/lib/h-promise/queries'
import { createExchangeBonus } from '@/lib/h-promise/server'

export const dynamic = 'force-dynamic'

/** The exchange bonus register. Phone numbers are masked for people who do not work the deal. */
export async function GET() {
  const access = await requireHPromiseApi((caps) => caps.register.view)
  if (access.denied) return access.denied
  try {
    return hpJson({ rows: await listExchangeBonuses(access.caps) })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const access = await requireHPromiseApi((caps) => caps.register.create)
  if (access.denied) return access.denied
  try {
    const row = await createExchangeBonus(actorOf(access.appUser), access.caps, await readJsonBody(request))
    return hpJson({ ok: true, row }, { status: 201 })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
