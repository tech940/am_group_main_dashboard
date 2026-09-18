import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { CarEvaluationLeadsPage } from '@/features/car-evaluations/car-evaluation-leads-page'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Car Evaluation Leads | AM Group',
  description: 'Owners who asked for a free used-car evaluation on the sell-your-car page.',
}

/*
 * The leads from the public /sell-used-car page. ⚠️ The guard names its key literally so
 * scripts/verify-guard-parity.ts can see it; GET /api/car-evaluations applies the same key.
 */
export default async function CarEvaluationLeadsRoute() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  const permission = await requirePermission(appUser, 'car_evaluations.view')
  if (!permission.allowed) forbidden()

  return <CarEvaluationLeadsPage />
}
