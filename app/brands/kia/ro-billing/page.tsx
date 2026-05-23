'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, TrendingUp, DollarSign, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ROBillingReportSectionProps {
  activeSheet: string | null
  sharedData?: DataRow[]
  dateFilter?: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}

interface RevenueMetrics {
  mtd: { cy: number; ly: number | string; growth: number | 'N/A' }
  qtd: { cy: number; ly: number | string; growth: number | 'N/A' }
  ytd: { cy: number; ly: number | string; growth: number | 'N/A' }
  td: { cy: number; ly: number | string; growth: number | 'N/A' }
}

interface GrowthStats {
  totalRevenue: { value: number | string | 'N/A'; trend: 'up' | 'down' | 'neutral' }
  paidService: { value: number; trend: 'up' | 'down' | 'neutral' }
}

type RevenueView = 'labour' | 'parts' | 'growth'

interface DataRow {
  [key: string]: unknown
}

interface ROBillingSheetData {
  sheetId: string
  sheetName: string
  columns: string[]
  rows: DataRow[]
}

export default function ROBillingReportSection({ activeSheet, sharedData, dateFilter }: ROBillingReportSectionProps) {
  const [loading, setLoading] = useState(!sharedData)
  const [roBillingData, setRoBillingData] = useState<ROBillingSheetData | null>(null)
  const [labourRevenue, setLabourRevenue] = useState<RevenueMetrics | null>(null)
  const [partsRevenue, setPartsRevenue] = useState<RevenueMetrics | null>(null)
  const [growthContribution, setGrowthContribution] = useState<GrowthStats | null>(null)
  const [activeView, setActiveView] = useState<RevenueView>('labour')

  // 1. Logic Helpers (Declared first to avoid hoisting issues)
  const processRevenueData = useCallback((rows: DataRow[]) => {
    if (!rows || rows.length === 0) {
      const emptyMetrics = {
        mtd: { cy: 0, ly: 'N/A' as const, growth: 'N/A' as const },
        qtd: { cy: 0, ly: 'N/A' as const, growth: 'N/A' as const },
        ytd: { cy: 0, ly: 'N/A' as const, growth: 'N/A' as const },
        td: { cy: 0, ly: 'N/A' as const, growth: 'N/A' as const }
      }
      setLabourRevenue(emptyMetrics)
      setPartsRevenue(emptyMetrics)
      setGrowthContribution({
        totalRevenue: { value: 0, trend: 'neutral' },
        paidService: { value: 0, trend: 'neutral' }
      })
      return
    }

    const findCol = (searchTerms: string[]) => {
      const headers = Object.keys(rows[0] || {})
      return headers.find(h => searchTerms.some(term => h.toLowerCase().trim() === term.toLowerCase().trim() || h.toLowerCase().includes(term.toLowerCase())))
    }

    const getVal = (row: DataRow, col?: string) => {
      if (!col) return 0
      const val = row[col]
      if (typeof val === 'number') return val
      if (val === null || val === undefined) return 0
      const parsed = parseFloat(String(val).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
      return isNaN(parsed) ? 0 : parsed
    }

    const getUniqueBillKey = (row: DataRow, fallbackIndex: number) => {
      const billNo = row.bill_no ?? row['Bill No']
      const roNo = row.ro_no ?? row['RO No']
      const primary = billNo !== null && billNo !== undefined && String(billNo).trim() !== ''
        ? String(billNo).trim()
        : roNo !== null && roNo !== undefined && String(roNo).trim() !== ''
          ? String(roNo).trim()
          : null

      return primary || `row-${fallbackIndex}`
    }

    const addBillAmount = (bucket: Map<string, number>, billKey: string, amount: number) => {
      const existing = bucket.get(billKey)
      if (existing === undefined || Math.abs(amount) > Math.abs(existing)) {
        bucket.set(billKey, amount)
      }
    }

    const sumBillAmounts = (bucket: Map<string, number>) => {
      return Array.from(bucket.values()).reduce((total, amount) => total + amount, 0)
    }

    // Parse date from DD/MM/YYYY or YYYY-MM-DD formats
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
      const trimmed = String(dateStr).trim()
      // Check YYYY-MM-DD
      if (trimmed.includes('-')) {
        const parts = trimmed.split('-')
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10)
          const month = parseInt(parts[1], 10) - 1
          const day = parseInt(parts[2], 10)
          if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month, day)
          }
        }
      }
      // Check DD/MM/YYYY
      const parts = trimmed.split('/')
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10)
        let month = parseInt(parts[1], 10) - 1
        const year = parseInt(parts[2], 10)

        if (month > 11) {
          const temp = day
          day = month + 1
          month = temp - 1
        }

        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
          return new Date(year, month, day)
        }
      }
      return null
    }

    // Detect Columns
    const labourCol = findCol(['labour_amt', 'labour amt', 'labour amount', 'labour total'])
    const partCol = findCol(['part_amt', 'part amt', 'part amount', 'part total', 'parts amt'])
    const totalCol = findCol(['total_amt', 'total amt', 'total amount', 'grand total'])
    const billDateCol = findCol(['bill_date', 'bill date', 'billdate'])
    const roDateCol = findCol(['ro_date', 'ro date', 'rodate'])
    const serviceTypeCol = findCol(['work_type', 'service_type', 'work type', 'service type'])

    // Boundary generator
    const getBoundaries = (): {
      cyMtdStart: Date; cyMtdEnd: Date; lyMtdStart: Date; lyMtdEnd: Date
      cyQtdStart: Date; cyQtdEnd: Date; lyQtdStart: Date; lyQtdEnd: Date
      cyYtdStart: Date; cyYtdEnd: Date; lyYtdStart: Date; lyYtdEnd: Date
      currentYear: number; currentMonth: number; currentDay: number; daysInMonth: number
    } => {
      const today = new Date()
      const todayYear = today.getFullYear()
      const todayMonth = today.getMonth()
      const todayDay = today.getDate()

      // Parse all dates to find default max year and month in dataset
      let maxDate = new Date(2025, 2, 31) // default fallback
      let foundAny = false
      rows.forEach(row => {
        const col = billDateCol || roDateCol
        const dateStr = String(row[col || ''] || '')
        const date = parseDate(dateStr)
        if (date) {
          if (!foundAny || date > maxDate) {
            maxDate = date
            foundAny = true
          }
        }
      })

      const defaultYear = maxDate.getFullYear()
      const defaultMonth = maxDate.getMonth()

      let cyYear = defaultYear
      let cyMonth = defaultMonth
      let cyDay = 31

      let isRangeMode = false
      let rangeStart = new Date()
      let rangeEnd = new Date()

      if (dateFilter) {
        if (dateFilter.mode === 'month') {
          cyYear = dateFilter.year
          cyMonth = dateFilter.month
          if (cyYear === todayYear && cyMonth === todayMonth) {
            cyDay = todayDay
          } else {
            cyDay = new Date(cyYear, cyMonth + 1, 0).getDate()
          }
        } else if (dateFilter.mode === 'range' && dateFilter.startDate && dateFilter.endDate) {
          isRangeMode = true
          rangeStart = parseDate(dateFilter.startDate) || new Date()
          rangeEnd = parseDate(dateFilter.endDate) || new Date()
          cyYear = rangeEnd.getFullYear()
          cyMonth = rangeEnd.getMonth()
          cyDay = rangeEnd.getDate()
        }
      } else {
        if (cyYear === todayYear && cyMonth === todayMonth) {
          cyDay = todayDay
        } else {
          cyDay = new Date(cyYear, cyMonth + 1, 0).getDate()
        }
      }

      const daysInMonth = new Date(cyYear, cyMonth + 1, 0).getDate()

      let cyMtdStart: Date, cyMtdEnd: Date, lyMtdStart: Date, lyMtdEnd: Date

      if (isRangeMode) {
        cyMtdStart = new Date(rangeStart)
        cyMtdStart.setHours(0, 0, 0, 0)
        cyMtdEnd = new Date(rangeEnd)
        cyMtdEnd.setHours(23, 59, 59, 999)

        lyMtdStart = new Date(rangeStart)
        lyMtdStart.setFullYear(lyMtdStart.getFullYear() - 1)
        lyMtdStart.setHours(0, 0, 0, 0)
        lyMtdEnd = new Date(rangeEnd)
        lyMtdEnd.setFullYear(lyMtdEnd.getFullYear() - 1)
        lyMtdEnd.setHours(23, 59, 59, 999)
      } else {
        cyMtdStart = new Date(cyYear, cyMonth, 1, 0, 0, 0, 0)
        cyMtdEnd = new Date(cyYear, cyMonth, cyDay, 23, 59, 59, 999)

        lyMtdStart = new Date(cyYear - 1, cyMonth, 1, 0, 0, 0, 0)
        lyMtdEnd = new Date(cyYear - 1, cyMonth, cyDay, 23, 59, 59, 999)
      }

      const quarterStartMonth = Math.floor(cyMonth / 3) * 3
      const cyQtdStart = new Date(cyYear, quarterStartMonth, 1, 0, 0, 0, 0)
      const cyQtdEnd = new Date(cyMtdEnd)

      const lyQtdStart = new Date(cyYear - 1, quarterStartMonth, 1, 0, 0, 0, 0)
      const lyQtdEnd = new Date(lyMtdEnd)

      let fiscalYearStartCY = cyYear
      if (cyMonth < 3) {
        fiscalYearStartCY = cyYear - 1
      }
      const cyYtdStart = new Date(fiscalYearStartCY, 3, 1, 0, 0, 0, 0)
      const cyYtdEnd = new Date(cyMtdEnd)

      const lyYtdStart = new Date(fiscalYearStartCY - 1, 3, 1, 0, 0, 0, 0)
      const lyYtdEnd = new Date(lyMtdEnd)

      return {
        cyMtdStart, cyMtdEnd, lyMtdStart, lyMtdEnd,
        cyQtdStart, cyQtdEnd, lyQtdStart, lyQtdEnd,
        cyYtdStart, cyYtdEnd, lyYtdStart, lyYtdEnd,
        currentYear: cyYear, currentMonth: cyMonth, currentDay: cyDay, daysInMonth
      }
    }

    const bounds = getBoundaries()
    const {
      cyMtdStart, cyMtdEnd, lyMtdStart, lyMtdEnd,
      cyQtdStart, cyQtdEnd, lyQtdStart, lyQtdEnd,
      cyYtdStart, cyYtdEnd, lyYtdStart, lyYtdEnd,
      currentYear, currentMonth, currentDay, daysInMonth
    } = bounds

    // Detect if we actually have previous year data in this dataset
    let hasLyData = false
    rows.forEach(row => {
      const col = billDateCol || roDateCol
      const dateStr = String(row[col || ''] || '')
      const date = parseDate(dateStr)
      if (date && date.getFullYear() === currentYear - 1) {
        hasLyData = true
      }
    })

    console.log('?? RO Billing Report Section - Derived Boundaries:', {
      currentYear,
      currentMonth: currentMonth + 1,
      currentDay,
      daysInMonth,
      hasLyData,
      cyMtd: `[${cyMtdStart.toISOString()} -> ${cyMtdEnd.toISOString()}]`,
      lyMtd: `[${lyMtdStart.toISOString()} -> ${lyMtdEnd.toISOString()}]`,
      totalRows: rows.length
    })

    // Calculate metrics based on boundaries. Revenue views must sum amounts, not count rows.
    const calculateMetrics = (amountCol?: string) => {
      const cyMtdKeys = new Set<string>()
      const lyMtdKeys = new Set<string>()
      const cyQtdKeys = new Set<string>()
      const lyQtdKeys = new Set<string>()
      const cyYtdKeys = new Set<string>()
      const lyYtdKeys = new Set<string>()
      const cyTdKeys = new Set<string>()
      const lyTdKeys = new Set<string>()
      const cyMtdAmounts = new Map<string, number>()
      const lyMtdAmounts = new Map<string, number>()
      const cyQtdAmounts = new Map<string, number>()
      const lyQtdAmounts = new Map<string, number>()
      const cyYtdAmounts = new Map<string, number>()
      const lyYtdAmounts = new Map<string, number>()
      const cyTdAmounts = new Map<string, number>()
      const lyTdAmounts = new Map<string, number>()

      const addMetric = (keys: Set<string>, amounts: Map<string, number>, billKey: string, amount: number) => {
        keys.add(billKey)
        if (amountCol) addBillAmount(amounts, billKey, amount)
      }

      const cyTdStart = new Date(cyMtdEnd)
      cyTdStart.setHours(0, 0, 0, 0)
      const cyTdEnd = new Date(cyMtdEnd)
      cyTdEnd.setHours(23, 59, 59, 999)
      const lyTdStart = new Date(lyMtdEnd)
      lyTdStart.setHours(0, 0, 0, 0)
      const lyTdEnd = new Date(lyMtdEnd)
      lyTdEnd.setHours(23, 59, 59, 999)

      rows.forEach((row, index) => {
        const dateStr = String(row[billDateCol || roDateCol || ''] || '')
        const date = parseDate(dateStr)
        const amount = getVal(row, amountCol)

        const shouldCount = amountCol ? amount !== 0 : true

        if (date && shouldCount) {
          const billKey = getUniqueBillKey(row, index)
          // MTD
          if (date >= cyMtdStart && date <= cyMtdEnd) {
            addMetric(cyMtdKeys, cyMtdAmounts, billKey, amount)
          }
          if (date >= lyMtdStart && date <= lyMtdEnd) {
            addMetric(lyMtdKeys, lyMtdAmounts, billKey, amount)
          }
          // QTD
          if (date >= cyQtdStart && date <= cyQtdEnd) {
            addMetric(cyQtdKeys, cyQtdAmounts, billKey, amount)
          }
          if (date >= lyQtdStart && date <= lyQtdEnd) {
            addMetric(lyQtdKeys, lyQtdAmounts, billKey, amount)
          }
          // YTD
          if (date >= cyYtdStart && date <= cyYtdEnd) {
            addMetric(cyYtdKeys, cyYtdAmounts, billKey, amount)
          }
          if (date >= lyYtdStart && date <= lyYtdEnd) {
            addMetric(lyYtdKeys, lyYtdAmounts, billKey, amount)
          }
          // TD uses only the selected/current Bill Date, not every historical row before it.
          if (date >= cyTdStart && date <= cyTdEnd) {
            addMetric(cyTdKeys, cyTdAmounts, billKey, amount)
          }
          if (date >= lyTdStart && date <= lyTdEnd) {
            addMetric(lyTdKeys, lyTdAmounts, billKey, amount)
          }
        }
      })

      const getPeriodValue = (keys: Set<string>, amounts: Map<string, number>) => {
        return amountCol ? sumBillAmounts(amounts) : keys.size
      }

      const mtd_cy = getPeriodValue(cyMtdKeys, cyMtdAmounts)
      const mtd_ly = getPeriodValue(lyMtdKeys, lyMtdAmounts)
      const qtd_cy = getPeriodValue(cyQtdKeys, cyQtdAmounts)
      const qtd_ly = getPeriodValue(lyQtdKeys, lyQtdAmounts)
      const ytd_cy = getPeriodValue(cyYtdKeys, cyYtdAmounts)
      const ytd_ly = getPeriodValue(lyYtdKeys, lyYtdAmounts)
      const td_cy = getPeriodValue(cyTdKeys, cyTdAmounts)
      const td_ly = getPeriodValue(lyTdKeys, lyTdAmounts)

      // Growth helper
      const calcGrowth = (cy: number, ly: number | 'N/A'): number | 'N/A' => {
        if (ly === 'N/A' || ly <= 0) return 'N/A'
        return ((cy - ly) / ly) * 100
      }

      const displayLy = hasLyData ? mtd_ly : 'N/A'
      const displayQtdLy = hasLyData ? qtd_ly : 'N/A'
      const displayYtdLy = hasLyData ? ytd_ly : 'N/A'
      const displayTdLy = hasLyData ? td_ly : 'N/A'

      console.log(`?? ${amountCol || 'Load'} Simple Counts:`, {
        mtd: { cy: mtd_cy, ly: displayLy },
        qtd: { cy: qtd_cy, ly: displayQtdLy },
        ytd: { cy: ytd_cy, ly: displayYtdLy },
        td: { cy: td_cy, ly: displayTdLy }
      })

      return {
        mtd: { cy: mtd_cy, ly: displayLy, growth: calcGrowth(mtd_cy, displayLy) },
        qtd: { cy: qtd_cy, ly: displayQtdLy, growth: calcGrowth(qtd_cy, displayQtdLy) },
        ytd: { cy: ytd_cy, ly: displayYtdLy, growth: calcGrowth(ytd_cy, displayYtdLy) },
        td: { cy: td_cy, ly: displayTdLy, growth: calcGrowth(td_cy, displayTdLy) }
      }
    }

    const labourMetrics = calculateMetrics(labourCol)
    const partsMetrics = calculateMetrics(partCol)
    const totalRevenueMetrics = totalCol ? calculateMetrics(totalCol) : {
      mtd: {
        cy: labourMetrics.mtd.cy + partsMetrics.mtd.cy,
        ly: typeof labourMetrics.mtd.ly === 'number' && typeof partsMetrics.mtd.ly === 'number' ? labourMetrics.mtd.ly + partsMetrics.mtd.ly : 'N/A' as const,
        growth: 'N/A' as const,
      },
      qtd: {
        cy: labourMetrics.qtd.cy + partsMetrics.qtd.cy,
        ly: typeof labourMetrics.qtd.ly === 'number' && typeof partsMetrics.qtd.ly === 'number' ? labourMetrics.qtd.ly + partsMetrics.qtd.ly : 'N/A' as const,
        growth: 'N/A' as const,
      },
      ytd: {
        cy: labourMetrics.ytd.cy + partsMetrics.ytd.cy,
        ly: typeof labourMetrics.ytd.ly === 'number' && typeof partsMetrics.ytd.ly === 'number' ? labourMetrics.ytd.ly + partsMetrics.ytd.ly : 'N/A' as const,
        growth: 'N/A' as const,
      },
      td: {
        cy: labourMetrics.td.cy + partsMetrics.td.cy,
        ly: typeof labourMetrics.td.ly === 'number' && typeof partsMetrics.td.ly === 'number' ? labourMetrics.td.ly + partsMetrics.td.ly : 'N/A' as const,
        growth: 'N/A' as const,
      },
    }
    setLabourRevenue(labourMetrics)
    setPartsRevenue(partsMetrics)

    // Growth contribution is based on revenue movement, not RO/load counts.
    const paidServiceRows = rows.filter(row => {
      const type = String(row[serviceTypeCol || ''] || '').toLowerCase()
      return type.includes('paid') && !type.includes('free')
    })

    const paidServiceRate = rows.length > 0 ? (paidServiceRows.length / rows.length) * 100 : 0
    const totalRevenueCy = totalRevenueMetrics.ytd.cy
    const totalRevenueLy = totalRevenueMetrics.ytd.ly
    const totalRevenueGrowthValue = typeof totalRevenueLy === 'number' && totalRevenueLy > 0
      ? ((totalRevenueCy - totalRevenueLy) / totalRevenueLy) * 100
      : 'N/A'

    setGrowthContribution({
      totalRevenue: {
        value: totalRevenueGrowthValue,
        trend: totalRevenueGrowthValue === 'N/A' ? 'neutral' : (totalRevenueGrowthValue > 0 ? 'up' : totalRevenueGrowthValue < 0 ? 'down' : 'neutral')
      },
      paidService: {
        value: paidServiceRate,
        trend: paidServiceRate > 50 ? 'up' : 'neutral'
      }
    })
  }, [dateFilter])

  const fetchROBillingData = useCallback(async () => {
    // If shared data is provided, use it directly
    if (sharedData && sharedData.length > 0) {
      console.log('? Using shared RO Billing data for Revenue Performance:', sharedData.length, 'records')
      setRoBillingData({
        sheetId: 'shared',
        sheetName: activeSheet || 'RO Billing Report March 25',
        columns: Object.keys(sharedData[0] || {}),
        rows: sharedData
      })
      processRevenueData(sharedData)
      setLoading(false)
      return
    }

    // Otherwise, fetch data independently (fallback)
    try {
      if (!loading) setLoading(true)
      console.log('?? Fetching RO Billing data for Revenue Performance...')

      const response = await fetch('/api/brands/kia/business-excellence?brand=kia')
      if (response.ok) {
        const sheets = await response.json()
        console.log('?? Available sheets:', sheets.map((s: { sheetName: string }) => s.sheetName))

        const roBillingSheet = sheets.find((sheet: { sheetName: string; id: string; columns: string[] }) =>
          sheet.sheetName.toLowerCase().includes('ro billing report march 25')
        )

        if (roBillingSheet) {
          console.log('? Found RO Billing sheet:', roBillingSheet.sheetName, 'ID:', roBillingSheet.id)

          const dataResponse = await fetch(`/api/brands/kia/business-excellence?sheetId=${roBillingSheet.id}&fetchAll=true`)
          if (dataResponse.ok) {
            const data = await dataResponse.json()
            const allRows = data.rows || []

            console.log('?? Fetched ALL rows for analytics:', allRows.length, 'records')
            console.log('?? Total rows in database:', data.totalRows)

            setRoBillingData({
              sheetId: roBillingSheet.id,
              sheetName: roBillingSheet.sheetName,
              columns: roBillingSheet.columns,
              rows: allRows
            })

            processRevenueData(allRows)
          } else {
            console.error('? Failed to fetch sheet data:', dataResponse.status)
          }
        } else {
          console.warn('?? RO Billing Report March 25 sheet not found')
        }
      }
    } catch (error) {
      console.error('? Error fetching RO Billing data:', error)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processRevenueData, sharedData, activeSheet])

  // 2. Guard Clauses & Render Helpers
  const isROBillingSheet = activeSheet?.toLowerCase().includes('ro billing')

  const renderMoney = (val: number | string | undefined | null) => {
    if (val === 'N/A' || val === undefined || val === null || isNaN(Number(val))) return 'N/A'
    return `₹ ${Math.round(Number(val)).toLocaleString('en-IN')}`
  }

  const moneyTextClass = (val: number | string | undefined | null, fallback = 'text-slate-900') => {
    if (val === 'N/A' || val === undefined || val === null || isNaN(Number(val))) return 'text-slate-400'
    return Number(val) < 0 ? 'text-rose-600' : fallback
  }

  const formatGrowth = (value: number | string | 'N/A') => {
    if (value === 'N/A') return 'N/A'
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (isNaN(num)) return 'N/A'
    return `${num >= 0 ? '+' : '-'}${Math.abs(num).toFixed(1)}%`
  }

  // 3. Effects
  useEffect(() => {
    if (isROBillingSheet) {
      const timer = setTimeout(() => {
        fetchROBillingData()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [fetchROBillingData, isROBillingSheet, sharedData])

  if (!isROBillingSheet) return null

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-teal-600" />
        <div className="text-center">
          <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Loading Performance Analysis</p>
          <p className="text-xs text-slate-400 mt-1">Fetching all 3,857 records for accurate calculations...</p>
        </div>
      </div>
    )
  }

  if (!labourRevenue || !partsRevenue || !growthContribution) {
    return (
      <div className="text-center py-12 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">No processing data found for RO Billing</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center border border-slate-200 shadow-sm">
          <TrendingUp className="h-5 w-5 text-slate-700" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-800 tracking-tight">Revenue Performance</h2>
          <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
            Real-time analysis from: {roBillingData?.sheetName || 'Source Sheet'}
          </p>
        </div>
      </div>

      {/* View Switcher */}
      <div className="flex items-center gap-3">
        {(['labour', 'parts', 'growth'] as const).map((view) => (
          <Button
            key={view}
            onClick={() => setActiveView(view)}
            className={cn(
              "rounded-xl font-bold transition-all px-6",
              activeView === view
                ? "bg-slate-800 text-white shadow-lg"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {view.charAt(0).toUpperCase() + view.slice(1)} Revenue
          </Button>
        ))}
      </div>

      {/* Data Tables */}
      {(activeView === 'labour' || activeView === 'parts') && (
        <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
          <CardHeader className={cn(
            "p-5 text-white",
            activeView === 'labour' ? "bg-blue-600" : "bg-purple-600"
          )}>
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              {activeView === 'labour' ? 'Labour' : 'Part'} Revenue Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-left text-[10px] font-black uppercase text-slate-400">Category</th>
                    <th colSpan={3} className="px-4 py-4 text-center text-[10px] font-black uppercase text-slate-400 border-x border-slate-100">MTD</th>
                    <th colSpan={3} className="px-4 py-4 text-center text-[10px] font-black uppercase text-slate-400 border-r border-slate-100">QTD</th>
                    <th colSpan={3} className="px-4 py-4 text-center text-[10px] font-black uppercase text-slate-400">YTD</th>
                  </tr>
                  <tr className="bg-white border-b border-slate-100">
                    <th className="px-6 py-2"></th>
                    {(['MTD', 'QTD', 'YTD'] as const).map(period => (
                      <React.Fragment key={period}>
                        <th className="px-2 py-2 text-[9px] font-bold text-slate-400">CY</th>
                        <th className="px-2 py-2 text-[9px] font-bold text-slate-400">LY</th>
                        <th className="px-2 py-2 text-[9px] font-bold text-slate-400 border-r border-slate-50 last:border-r-0">%</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const data = activeView === 'labour' ? labourRevenue : partsRevenue
                    return (
                      <tr className="hover:bg-slate-50/50">
                        <td className="px-6 py-6 text-sm font-black text-slate-700">Total {activeView.charAt(0).toUpperCase() + activeView.slice(1)}</td>
                        {(['mtd', 'qtd', 'ytd'] as const).map(period => (
                          <React.Fragment key={period}>
                            <td className={cn("px-4 py-6 text-sm font-bold text-center", moneyTextClass(data[period].cy))}>{renderMoney(data[period].cy)}</td>
                            <td className={cn("px-4 py-6 text-sm font-medium text-center", moneyTextClass(data[period].ly, 'text-slate-400'))}>{renderMoney(data[period].ly)}</td>
                            <td className={cn(
                              "px-4 py-6 text-sm font-black text-center border-r border-slate-50 last:border-r-0",
                              data[period].growth === 'N/A'
                                ? "text-slate-400"
                                : Number(data[period].growth) >= 0
                                  ? "text-teal-700"
                                  : "text-rose-600"
                            )}>
                              {formatGrowth(data[period].growth)}
                            </td>
                          </React.Fragment>
                        ))}
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Growth Contribution */}
      {activeView === 'growth' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="rounded-3xl border-none shadow-xl shadow-slate-200/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Revenue Growth</CardTitle>
              <BarChart3 className={cn("h-4 w-4", growthContribution.totalRevenue.trend === 'down' ? "text-rose-500" : "text-teal-600")} />
            </CardHeader>
            <CardContent>
              <div className={cn(
                "text-3xl font-black",
                growthContribution.totalRevenue.trend === 'down' ? "text-rose-600" : growthContribution.totalRevenue.trend === 'up' ? "text-teal-700" : "text-slate-800"
              )}>{formatGrowth(growthContribution.totalRevenue.value)}</div>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Month over Month</p>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-none shadow-xl shadow-slate-200/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Paid Service Contribution</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{growthContribution.paidService.value.toFixed(1)}%</div>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Of total workshop load</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

