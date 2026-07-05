'use client'

import dynamic from 'next/dynamic'

const DynamicReport = dynamic(
  () => import('./stock-report-client').then((mod) => mod.KiaStockReportPage),
  { ssr: false }
)

export function StockReportWrapper({ initialSearchParams }: { initialSearchParams: any }) {
  return <DynamicReport initialSearchParams={initialSearchParams} />
}
