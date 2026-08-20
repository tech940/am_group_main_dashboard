import { forbidden, redirect } from 'next/navigation'
import { HyundaiSalesReportClient } from './sales-report-client'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Sales Report | AM Hyundai',
  description: 'AM Hyundai sales report analytics and raw source report tables',
}

export default async function HyundaiSalesReportRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('hyundai')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'hyundai.sales_report.view')
  if (!permission.allowed) forbidden()

  const resolvedSearchParams = await searchParams
  return <HyundaiSalesReportClient initialSearchParams={resolvedSearchParams} currentUserRole={access.appUser.role} />
}
