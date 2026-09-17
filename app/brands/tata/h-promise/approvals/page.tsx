import { requireHPromisePage } from '@/lib/h-promise/access'
import { HPromisePage } from '../h-promise-view'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'H Promise · Approvals | AM Tata',
}

/*
 * The Access Map's "Approvals" column links here. It is the same single H Promise page, opened on its tab.
 * ⚠️ The guard names its key literally so scripts/verify-guard-parity.ts can see it.
 */
export default async function HPromiseApprovalsPage() {
  const { caps } = await requireHPromisePage('tata.h_promise.approvals.view')
  return <HPromisePage caps={caps} initialTab="approvals" />
}
