import { requireHPromisePage } from '@/lib/h-promise/access'
import { HPromisePage } from '../h-promise-view'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'H Promise · Vehicle Register | AM Tata',
}

/*
 * The Access Map's "Vehicle Register" column links here. It is the same single H Promise page, opened on its tab.
 * ⚠️ The guard names its key literally so scripts/verify-guard-parity.ts can see it.
 */
export default async function HPromiseRegisterPage() {
  const { caps } = await requireHPromisePage('tata.h_promise.register.view')
  return <HPromisePage caps={caps} initialTab="vehicles" />
}
