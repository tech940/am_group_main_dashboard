'use client'

import { PlatinumSalesReportPage } from '@/features/platinum/platinum-sales-report-page'

export function PlatinumSalesReportClient({
  initialSearchParams = {},
  currentUserRole = null,
}: {
  initialSearchParams?: Record<string, string | string[] | undefined>
  currentUserRole?: string | null
}) {
  return (
    <PlatinumSalesReportPage
      initialSearchParams={initialSearchParams}
      currentUserRole={currentUserRole}
    />
  )
}
