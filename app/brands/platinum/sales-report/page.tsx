import { forbidden, redirect } from 'next/navigation'
import { PlatinumSalesReportClient } from './sales-report-client'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Sales Report | AM Platinum',
  description: 'AM Platinum sales report analytics and raw source report tables',
}

export default async function PlatinumSalesReportRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('platinum')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'platinum.sales_report.view')
  if (!permission.allowed) forbidden()

  const resolvedSearchParams = await searchParams
  return <PlatinumSalesReportClient initialSearchParams={resolvedSearchParams} currentUserRole={access.appUser.role} />
}
