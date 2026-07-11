import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { KiaSalesPerformancePage } from '@/features/kia/kia-sales-performance-page'

export const metadata = {
  title: 'Sales Performance | AM Kia',
  description: 'AM Kia consultant sales targets and leaderboard',
}

// Managers may set targets; everyone with view access sees the leaderboard.
const TARGET_MANAGER_ROLES = new Set(['general_manager', 'sales_manager', 'sales_head', 'md', 'eba', 'admin', 'developer'])

export default async function KiaSalesPerformanceRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.sales_performance.view')
  if (!permission.allowed) forbidden()

  return <KiaSalesPerformancePage canSetTargets={TARGET_MANAGER_ROLES.has(access.appUser.role)} />
}
