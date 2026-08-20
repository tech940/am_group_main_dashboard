'use client'

import { HyundaiSalesReportPage } from '@/features/hyundai/hyundai-sales-report-page'

export function HyundaiSalesReportClient({
  initialSearchParams = {},
  currentUserRole = null,
}: {
  initialSearchParams?: Record<string, string | string[] | undefined>
  currentUserRole?: string | null
}) {
  return (
    <HyundaiSalesReportPage
      initialSearchParams={initialSearchParams}
      currentUserRole={currentUserRole}
    />
  )
}
