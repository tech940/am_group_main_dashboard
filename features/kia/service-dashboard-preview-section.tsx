'use client'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { logApiTimings } from '@/lib/api/client-timing'
import {
  BusinessDateFilterValue,
  getEffectiveBusinessDateFilter,
} from '@/lib/business-excellence/comparison'
import { appendKiaDealerCodeParam } from '@/lib/kia/dealer-branch'
import { appendPlatinumDealerCodeParam } from '@/lib/platinum/dealer-branch'
import { appendHyundaiDealerCodeParam } from '@/lib/hyundai/dealer-branch'

type PreviewCell = {
  address: string
  text: string
  colspan: number
  rowspan: number
  hidden: boolean
  style: Record<string, string | number | boolean | undefined>
}

type PreviewPayload = {
  sheetName: string
  range: string
  fileName: string
  metrics: {
    exportDate: string
    monthStart: string
    sourceWarnings?: string[]
  }
  columns: Array<{ key: string; width: number }>
  rows: Array<{
    index: number
    height: number | null
    cells: PreviewCell[]
  }>
  merges: string[]
}

function columnWidthToPx(width: number) {
  return Math.max(60, Math.round(width * 7.2))
}

function rowHeightToPx(height: number | null) {
  return height ? Math.round(height * 1.35) : 27
}

function buildPreviewQuery(
  dateFilter: BusinessDateFilterValue | null,
  dealerCode: string | null | undefined,
  brand: 'kia' | 'platinum' | 'hyundai',
) {
  const effectiveFilter = getEffectiveBusinessDateFilter(dateFilter)
  const params = new URLSearchParams({ endDate: effectiveFilter.endDate })
  if (brand === 'platinum') appendPlatinumDealerCodeParam(params, dealerCode)
  else if (brand === 'hyundai') appendHyundaiDealerCodeParam(params, dealerCode)
  else appendKiaDealerCodeParam(params, dealerCode)
  return params
}

function cssCellStyle(cell: PreviewCell, rowHeight: number): CSSProperties {
  return {
    backgroundColor: typeof cell.style.backgroundColor === 'string' ? cell.style.backgroundColor : undefined,
    color: typeof cell.style.color === 'string' ? cell.style.color : undefined,
    fontWeight: typeof cell.style.fontWeight === 'number' ? cell.style.fontWeight : undefined,
    fontSize: typeof cell.style.fontSize === 'number' ? cell.style.fontSize : undefined,
    fontFamily: typeof cell.style.fontFamily === 'string' ? cell.style.fontFamily : undefined,
    textAlign: typeof cell.style.textAlign === 'string' ? cell.style.textAlign as CSSProperties['textAlign'] : 'center',
    verticalAlign: typeof cell.style.verticalAlign === 'string' ? cell.style.verticalAlign as CSSProperties['verticalAlign'] : 'middle',
    borderTop: typeof cell.style.borderTop === 'string' ? cell.style.borderTop : '1px solid #d1d5db',
    borderRight: typeof cell.style.borderRight === 'string' ? cell.style.borderRight : '1px solid #d1d5db',
    borderBottom: typeof cell.style.borderBottom === 'string' ? cell.style.borderBottom : '1px solid #d1d5db',
    borderLeft: typeof cell.style.borderLeft === 'string' ? cell.style.borderLeft : '1px solid #d1d5db',
    whiteSpace: cell.style.wrapText ? 'normal' : 'nowrap',
    height: rowHeight,
    minHeight: rowHeight,
  }
}

export function ServiceDashboardPreviewSection({
  dateFilter,
  dealerCode,
  onDownload,
  downloading,
  brand,
}: {
  dateFilter: BusinessDateFilterValue | null
  dealerCode?: string | null
  onDownload: () => void
  downloading: boolean
  brand: 'kia' | 'platinum' | 'hyundai'
}) {
  const queryString = useMemo(
    () => buildPreviewQuery(dateFilter, dealerCode, brand).toString(),
    [brand, dateFilter, dealerCode],
  )
  const previewQuery = useQuery({
    queryKey: [brand, 'service-dashboard-preview', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/${brand}/business-excellence/service-dashboard-preview?${queryString}`, {
        cache: 'no-store',
      })
      logApiTimings(response, `${brand}-service-dashboard-preview`)
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to load Service Dashboard preview')
      return data as PreviewPayload
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const preview = previewQuery.data
  const tableWidth = preview?.columns.reduce((sum, column) => sum + columnWidthToPx(column.width), 0) || 520

  return (
    <div className="space-y-4 p-4">
      <Card className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-950">
                <FileSpreadsheet className="h-5 w-5 text-[var(--dashboard-action-bg)]" />
                Service Dashboard Sheet
              </CardTitle>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Same one-sheet format as the downloaded Excel workbook.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void previewQuery.refetch()}
                disabled={previewQuery.isFetching}
                className="app-outline-action h-9 rounded-xl px-3 text-xs font-black"
              >
                {previewQuery.isFetching ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onDownload}
                disabled={downloading}
                className="app-primary-action h-9 rounded-xl px-3 text-xs font-black"
              >
                {downloading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                Download Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {previewQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="h-8 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : previewQuery.isError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              {previewQuery.error instanceof Error ? previewQuery.error.message : 'Failed to load Service Dashboard preview'}
            </div>
          ) : preview ? (
            <div className="space-y-3">
              {preview.metrics.sourceWarnings?.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                  {preview.metrics.sourceWarnings.join(' ')}
                </div>
              ) : null}
              <div className="overflow-auto rounded-xl border border-slate-300 bg-slate-100 p-3">
                <table
                  className="border-collapse bg-white text-[12px]"
                  style={{
                    tableLayout: 'fixed',
                    width: tableWidth,
                  }}
                >
                  <colgroup>
                    {preview.columns.map((column) => (
                      <col key={column.key} style={{ width: columnWidthToPx(column.width) }} />
                    ))}
                  </colgroup>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.index} style={{ height: rowHeightToPx(row.height) }}>
                        {row.cells.filter((cell) => !cell.hidden).map((cell) => (
                          <td
                            key={cell.address}
                            colSpan={cell.colspan}
                            rowSpan={cell.rowspan}
                            className="px-2 py-1 leading-tight"
                            style={cssCellStyle(cell, rowHeightToPx(row.height))}
                            title={cell.address}
                          >
                            {cell.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

export function KiaServiceDashboardPreviewSection(
  props: Omit<React.ComponentProps<typeof ServiceDashboardPreviewSection>, 'brand'>,
) {
  return <ServiceDashboardPreviewSection {...props} brand="kia" />
}
