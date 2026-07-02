import { forbidden, redirect } from 'next/navigation'
import { KiaStockManagementPage } from './stock-management-client'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Stock Management | AM Kia',
  description: 'Manage KIA BBND and local retail stock overrides',
}

export default async function KiaStockManagementRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.stock_management.view')
  if (!permission.allowed) forbidden()

  const resolvedSearchParams = await searchParams
  return <KiaStockManagementPage initialSearchParams={resolvedSearchParams} />
}
