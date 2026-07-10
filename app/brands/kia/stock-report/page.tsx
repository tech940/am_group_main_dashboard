import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { StockReportWrapper } from './stock-report-wrapper'

export const metadata = {
  title: 'Stock Report | AM Kia',
  description: 'AM Kia vehicle stock analytics and purchase report table',
}

export default async function KiaStockReportRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.stock_report.view')
  if (!permission.allowed) forbidden()

  const resolvedSearchParams = await searchParams
  return <StockReportWrapper initialSearchParams={resolvedSearchParams} />
}
