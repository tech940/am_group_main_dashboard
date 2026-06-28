import { forbidden, redirect } from 'next/navigation'
import { KiaSalesReportPage } from './sales-report-client'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Sales Report | AM Kia',
  description: 'AM Kia sales report analytics and raw source report tables',
}

export default async function KiaSalesReportRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.sales_report.view')
  if (!permission.allowed) forbidden()

  const resolvedSearchParams = await searchParams
  return <KiaSalesReportPage initialSearchParams={resolvedSearchParams} />
}
