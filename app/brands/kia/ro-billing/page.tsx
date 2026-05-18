'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, TrendingUp, DollarSign, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ROBillingReportSectionProps {
  activeSheet: string | null
  sharedData?: DataRow[]
}

interface RevenueMetrics {
  mtd: { cy: number; ly: number; growth: number }
  qtd: { cy: number; ly: number; growth: number }
  ytd: { cy: number; ly: number; growth: number }
}

interface GrowthStats {
  load: { value: number; trend: 'up' | 'down' | 'neutral' }
  paidService: { value: number; trend: 'up' | 'down' | 'neutral' }
}

type RevenueView = 'labour' | 'parts' | 'growth'

interface DataRow {
  [key: string]: unknown
}

interface ROBillingSheetData {
  sheetId: string
  sheetName: string
  headers: string[]
  rows: DataRow[]
}

export default function ROBillingReportSection({ activeSheet, sharedData }: ROBillingReportSectionProps) {
  console.log('🚀 ROBillingReportSection RENDERED:', {
    activeSheet,
    hasSharedData: !!(sharedData && sharedData.length > 0),
    sharedDataLength: sharedData?.length || 0
  })

  const [loading, setLoading] = useState(!sharedData)
  const [roBillingData, setRoBillingData] = useState<ROBillingSheetData | null>(null)
  const [labourRevenue, setLabourRevenue] = useState<RevenueMetrics | null>(null)
  const [partsRevenue, setPartsRevenue] = useState<RevenueMetrics | null>(null)
  const [growthContribution, setGrowthContribution] = useState<GrowthStats | null>(null)
  const [activeView, setActiveView] = useState<RevenueView>('labour')
  const [dateContext, setDateContext] = useState<{currentYear: number, currentMonth: number, currentDay: number, daysInMonth: number} | null>(null)

  // 1. Logic Helpers (Declared first to avoid hoisting issues)
  const processRevenueData = useCallback((rows: DataRow[]) => {
    if (!rows || rows.length === 0) {
      const emptyMetrics = {
        mtd: { cy: 0, ly: 0, growth: 0 },
        qtd: { cy: 0, ly: 0, growth: 0 },
        ytd: { cy: 0, ly: 0, growth: 0 }
      }
      setLabourRevenue(emptyMetrics)
      setPartsRevenue(emptyMetrics)
      setGrowthContribution({
        load: { value: 0, trend: 'neutral' },
        paidService: { value: 0, trend: 'neutral' }
      })
      return
    }

    const findCol = (searchTerms: string[]) => {
      const headers = Object.keys(rows[0] || {})
      return headers.find(h => searchTerms.some(term => h.toLowerCase().includes(term.toLowerCase())))
    }

    const getVal = (row: DataRow, col?: string) => {
      if (!col) return 0
      const val = row[col]
      if (typeof val === 'number') return val
      return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0
    }

    // Parse date from DD/MM/YYYY format
    // Handle both DD/MM/YYYY and MM/DD/YYYY formats (some dates may be swapped)
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
      const parts = String(dateStr).trim().split('/')
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10)
        let month = parseInt(parts[1], 10) - 1 // JS months are 0-indexed
        const year = parseInt(parts[2], 10)
        
        // If month > 12, it's likely DD/MM/YYYY format but was entered as MM/DD/YYYY
        // Swap day and month
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
    const labourCol = findCol(['labour amt', 'labour amount', 'labour total'])
    const partCol = findCol(['part amt', 'part amount', 'part total', 'parts amt'])
    const billDateCol = findCol(['bill date', 'billdate'])
    const roDateCol = findCol(['ro date', 'rodate'])
    const serviceTypeCol = findCol(['service type', 'work type'])

    // Get current date context by scanning ALL rows to find the true maximum year
    const allYearsInData = new Set<number>()
    const monthsInCurrentYear: number[] = []
    
    rows.forEach(row => {
      const dateStr = String(row[billDateCol || roDateCol || ''] || '')
      const date = parseDate(dateStr)
      if (date) {
        allYearsInData.add(date.getFullYear())
      }
    })
    
    // Dynamically detect the current year from the data (use the maximum year found)
    const currentYear = allYearsInData.size > 0
      ? Math.max(...Array.from(allYearsInData))
      : new Date().getFullYear()
    
    // Find all months that have data in the current year
    rows.forEach(row => {
      const dateStr = String(row[billDateCol || roDateCol || ''] || '')
      const date = parseDate(dateStr)
      if (date && date.getFullYear() === currentYear) {
        const month = date.getMonth()
        if (!monthsInCurrentYear.includes(month)) {
          monthsInCurrentYear.push(month)
        }
      }
    })
    
    // Use the most recent month that has data in the current year
    const currentMonth = monthsInCurrentYear.length > 0
      ? Math.max(...monthsInCurrentYear)
      : new Date().getMonth()
    
    const currentQuarter = Math.floor(currentMonth / 3)
    
    // Use TODAY'S calendar date for MTD calculations
    // This ensures MTD Target is proportional to actual days elapsed in the current month
    const today = new Date()
    const todayYear = today.getFullYear()
    const todayMonth = today.getMonth()
    const todayDay = today.getDate()
    
    // Always use today's day for current calendar month calculations
    const currentDay = todayDay
    const daysInMonth = new Date(todayYear, todayMonth + 1, 0).getDate()
    
    // Update year and month to current calendar date (not data date)
    const actualCurrentYear = todayYear
    const actualCurrentMonth = todayMonth
    
    // Store date context for KPI calculations (using actual calendar date)
    setDateContext({
      currentYear: actualCurrentYear,
      currentMonth: actualCurrentMonth,
      currentDay,
      daysInMonth
    })
    
    console.log('📅 RO Billing - Date context:', {
      dataYear: currentYear,
      dataMonth: currentMonth + 1,
      actualCurrentYear,
      actualCurrentMonth: actualCurrentMonth + 1,
      currentDay,
      daysInMonth,
      note: 'Using TODAY\'S date (May 14) for MTD calculations, not last date in data (April 30)',
      monthsWithDataInCY: monthsInCurrentYear.map(m => m + 1).sort(),
      allYearsInData: Array.from(allYearsInData).sort(),
      totalRecords: rows.length
    })

    // Helper to check if date falls in specific period
    const isInPeriod = (date: Date | null, year: number, periodType: 'mtd' | 'qtd' | 'ytd') => {
      if (!date) return false
      const dateYear = date.getFullYear()
      const dateMonth = date.getMonth()
      const dateQuarter = Math.floor(dateMonth / 3)

      if (dateYear !== year) return false

      switch (periodType) {
        case 'mtd':
          return dateMonth === currentMonth
        case 'qtd':
          return dateQuarter === currentQuarter
        case 'ytd':
          return true // All dates in the year
        default:
          return false
      }
    }

    // Calculate metrics based on date filtering
    const calculateMetrics = (amountCol?: string) => {
      let mtd_cy = 0, mtd_ly = 0, qtd_cy = 0, qtd_ly = 0, ytd_cy = 0, ytd_ly = 0
      let mtd_cy_count = 0, mtd_ly_count = 0

      rows.forEach(row => {
        const dateStr = String(row[billDateCol || roDateCol || ''] || '')
        const date = parseDate(dateStr)
        const amount = getVal(row, amountCol)

        if (date) {
          // Current Year (CY)
          if (isInPeriod(date, currentYear, 'mtd')) {
            mtd_cy += amount
            mtd_cy_count++
          }
          if (isInPeriod(date, currentYear, 'qtd')) qtd_cy += amount
          if (isInPeriod(date, currentYear, 'ytd')) ytd_cy += amount

          // Last Year (LY)
          if (isInPeriod(date, currentYear - 1, 'mtd')) {
            mtd_ly += amount
            mtd_ly_count++
          }
          if (isInPeriod(date, currentYear - 1, 'qtd')) qtd_ly += amount
          if (isInPeriod(date, currentYear - 1, 'ytd')) ytd_ly += amount
        }
      })

      console.log(`💰 ${amountCol} Revenue:`, {
        mtd: { cy: mtd_cy, ly: mtd_ly, cy_count: mtd_cy_count, ly_count: mtd_ly_count },
        qtd: { cy: qtd_cy, ly: qtd_ly },
        ytd: { cy: ytd_cy, ly: ytd_ly }
      })

      // Growth helper
      const calcGrowth = (cy: number, ly: number) => (ly > 0 ? ((cy - ly) / ly) * 100 : 0)

      return {
        mtd: { cy: mtd_cy, ly: mtd_ly, growth: calcGrowth(mtd_cy, mtd_ly) },
        qtd: { cy: qtd_cy, ly: qtd_ly, growth: calcGrowth(qtd_cy, qtd_ly) },
        ytd: { cy: ytd_cy, ly: ytd_ly, growth: calcGrowth(ytd_cy, ytd_ly) }
      }
    }

    // Calculate Load (count of entries) based on dates
    const calculateLoadMetrics = () => {
      let mtd_cy = 0, mtd_ly = 0, qtd_cy = 0, qtd_ly = 0, ytd_cy = 0, ytd_ly = 0
      let validDates = 0, invalidDates = 0

      rows.forEach(row => {
        const dateStr = String(row[billDateCol || roDateCol || ''] || '')
        const date = parseDate(dateStr)

        if (date) {
          validDates++
          // Current Year (CY) - count entries
          if (isInPeriod(date, currentYear, 'mtd')) mtd_cy++
          if (isInPeriod(date, currentYear, 'qtd')) qtd_cy++
          if (isInPeriod(date, currentYear, 'ytd')) ytd_cy++

          // Last Year (LY) - count entries
          if (isInPeriod(date, currentYear - 1, 'mtd')) mtd_ly++
          if (isInPeriod(date, currentYear - 1, 'qtd')) qtd_ly++
          if (isInPeriod(date, currentYear - 1, 'ytd')) ytd_ly++
        } else {
          invalidDates++
        }
      })

      console.log('📅 Date parsing results:', {
        totalRows: rows.length,
        validDates,
        invalidDates,
        billDateCol,
        roDateCol,
        currentYear,
        currentMonth,
        currentQuarter
      })
      
      console.log('📊 Load counts:', {
        mtd: { cy: mtd_cy, ly: mtd_ly },
        qtd: { cy: qtd_cy, ly: qtd_ly },
        ytd: { cy: ytd_cy, ly: ytd_ly }
      })

      const calcGrowth = (cy: number, ly: number) => (ly > 0 ? ((cy - ly) / ly) * 100 : 0)

      return {
        mtd: { cy: mtd_cy, ly: mtd_ly, growth: calcGrowth(mtd_cy, mtd_ly) },
        qtd: { cy: qtd_cy, ly: qtd_ly, growth: calcGrowth(qtd_cy, qtd_ly) },
        ytd: { cy: ytd_cy, ly: ytd_ly, growth: calcGrowth(ytd_cy, ytd_ly) }
      }
    }

    setLabourRevenue(calculateMetrics(labourCol))
    setPartsRevenue(calculateMetrics(partCol))

    // Calculate Load growth (count-based)
    const loadMetrics = calculateLoadMetrics()
    
    // Growth Contribution calculation
    const paidServiceRows = rows.filter(row => {
      const type = String(row[serviceTypeCol || ''] || '').toLowerCase()
      return type.includes('paid') && !type.includes('free')
    })
    
    const paidServiceRate = rows.length > 0 ? (paidServiceRows.length / rows.length) * 100 : 0
    const loadGrowthValue = loadMetrics.ytd.growth // Use YTD growth for load
    
    setGrowthContribution({
      load: {
        value: loadGrowthValue,
        trend: loadGrowthValue > 0 ? 'up' : loadGrowthValue < 0 ? 'down' : 'neutral'
      },
      paidService: {
        value: paidServiceRate,
        trend: paidServiceRate > 50 ? 'up' : 'neutral'
      }
    })
  }, [])

  const fetchROBillingData = useCallback(async () => {
    // If shared data is provided, use it directly
    if (sharedData && sharedData.length > 0) {
      console.log('✅ Using shared RO Billing data for Revenue Performance:', sharedData.length, 'records')
      setRoBillingData({
        sheetId: 'shared',
        sheetName: activeSheet || 'RO Billing Report March 25',
        headers: Object.keys(sharedData[0] || {}),
        rows: sharedData
      })
      processRevenueData(sharedData)
      setLoading(false)
      return
    }

    // Otherwise, fetch data independently (fallback)
    try {
      if (!loading) setLoading(true)
      console.log('🔍 Fetching RO Billing data for Revenue Performance...')
      
      const response = await fetch('/api/brands/kia/business-excellence?brand=kia')
      if (response.ok) {
        const sheets = await response.json()
        console.log('📊 Available sheets:', sheets.map((s: { sheetName: string }) => s.sheetName))
        
        const roBillingSheet = sheets.find((sheet: { sheetName: string; id: string; headers: string[] }) =>
          sheet.sheetName.toLowerCase().includes('ro billing report march 25')
        )
        
        if (roBillingSheet) {
          console.log('✅ Found RO Billing sheet:', roBillingSheet.sheetName, 'ID:', roBillingSheet.id)
          
          const dataResponse = await fetch(`/api/brands/kia/business-excellence?sheetId=${roBillingSheet.id}&fetchAll=true`)
          if (dataResponse.ok) {
            const data = await dataResponse.json()
            const allRows = data.rows || []
            
            console.log('📈 Fetched ALL rows for analytics:', allRows.length, 'records')
            console.log('📋 Total rows in database:', data.totalRows)
            
            setRoBillingData({
              sheetId: roBillingSheet.id,
              sheetName: roBillingSheet.sheetName,
              headers: roBillingSheet.headers,
              rows: allRows
            })
            
            processRevenueData(allRows)
          } else {
            console.error('❌ Failed to fetch sheet data:', dataResponse.status)
          }
        } else {
          console.warn('⚠️ RO Billing Report March 25 sheet not found')
        }
      }
    } catch (error) {
      console.error('❌ Error fetching RO Billing data:', error)
    } finally {
      setLoading(false)
    }
  }, [processRevenueData, sharedData, activeSheet])

  // 2. Guard Clauses & Render Helpers
  console.log('🔍 RO Billing Check - activeSheet:', activeSheet)
  const isROBillingSheet = activeSheet?.toLowerCase().includes('ro billing report march 25')
  console.log('🔍 RO Billing Check - isROBillingSheet:', isROBillingSheet)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value)
  }

  const formatGrowth = (value: number) => {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
  }

  // 3. Effects
  useEffect(() => {
    if (isROBillingSheet) {
      fetchROBillingData()
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

  // Calculate KPI metrics
  const calculateKPIs = () => {
    const currentData = activeView === 'labour' ? labourRevenue : partsRevenue
    
    console.log('🔍 Current Data for KPIs:', {
      activeView,
      labourRevenue,
      partsRevenue,
      currentData
    })
    
    const mtdCY = currentData.mtd.cy
    const ytdCY = currentData.ytd.cy
    
    // Use the date context from processRevenueData
    if (!dateContext) {
      console.warn('⚠️ No date context available for KPI calculations')
      return {
        monthTarget: 0,
        mtdTarget: 0,
        achTillDate: 0,
        shortfallTD: 0,
        monthlyShortfall: 0,
        projectedClosing: 0,
        askingRate: 0
      }
    }
    
    const { currentYear, currentMonth, currentDay, daysInMonth } = dateContext
    
    console.log('📅 Using Date Context for KPIs:', {
      currentYear,
      currentMonth: currentMonth + 1,
      currentDay,
      daysInMonth
    })
    
    // Month Target: Based on YTD average with 10% growth
    const monthsElapsed = currentMonth + 1 // Months from Jan to current month
    const avgMonthlyRevenue = monthsElapsed > 0 ? ytdCY / monthsElapsed : ytdCY
    const monthTarget = avgMonthlyRevenue * 1.1 // 10% growth target
    
    // MTD Target: Proportional target for current day
    const mtdTarget = monthTarget * (currentDay / daysInMonth)
    
    console.log('🔢 MTD Calculation Breakdown:', {
      monthTarget,
      currentDay,
      daysInMonth,
      ratio: currentDay / daysInMonth,
      mtdTarget,
      'MTD = Month Target?': mtdTarget === monthTarget,
      'Reason': currentDay === daysInMonth ? 'currentDay equals daysInMonth (end of month)' : 'Should be different'
    })
    
    // Ach Till Date: Current MTD CY
    const achTillDate = mtdCY
    
    // Shortfall T.D: Difference between MTD target and achieved
    const shortfallTD = mtdTarget - achTillDate
    
    // Projected Closing: Based on current pace
    const projectedClosing = achTillDate * (daysInMonth / currentDay)
    
    // Monthly Shortfall: Difference between month target and projected closing
    const monthlyShortfall = monthTarget - projectedClosing
    
    // Asking Rate: Required daily rate to meet target
    const remainingDays = daysInMonth - currentDay
    const askingRate = remainingDays > 0 ? monthlyShortfall / remainingDays : 0
    
    console.log('📊 KPI Calculations:', {
      activeView,
      mtdCY,
      ytdCY,
      avgMonthlyRevenue,
      monthTarget,
      mtdTarget,
      achTillDate,
      projectedClosing,
      currentDay,
      daysInMonth
    })
    
    return {
      monthTarget,
      mtdTarget,
      achTillDate,
      shortfallTD,
      monthlyShortfall,
      projectedClosing,
      askingRate
    }
  }

  console.log('🔍 Before calculateKPIs:', {
    hasLabourRevenue: !!labourRevenue,
    hasPartsRevenue: !!partsRevenue,
    hasSharedData: !!(sharedData && sharedData.length > 0),
    hasRoBillingData: !!roBillingData,
    labourRevenue,
    partsRevenue
  })

  const kpis = labourRevenue && partsRevenue ? calculateKPIs() : null

  console.log('🔍 After calculateKPIs:', { kpis })

  if (!kpis) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-teal-600" />
        <div className="text-center">
          <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Calculating KPIs</p>
          <p className="text-xs text-slate-400 mt-1">Processing revenue data...</p>
        </div>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Month Target</p>
            <p className="text-xl font-black text-slate-900">
              {kpis.monthTarget >= 100000
                ? `₹${(kpis.monthTarget / 100000).toFixed(2)} L`
                : `₹${Math.round(kpis.monthTarget).toLocaleString()}`
              }
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">MTD Target</p>
            <p className="text-xl font-black text-slate-900">
              {kpis.mtdTarget >= 100000
                ? `₹${(kpis.mtdTarget / 100000).toFixed(2)} L`
                : `₹${Math.round(kpis.mtdTarget).toLocaleString()}`
              }
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Ach Till Date</p>
            <p className="text-xl font-black text-slate-900">
              ₹{Math.round(kpis.achTillDate).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Shortfall T.D</p>
            <p className={cn(
              "text-xl font-black",
              kpis.shortfallTD > 0 ? "text-rose-600" : "text-emerald-600"
            )}>
              {kpis.shortfallTD >= 100000
                ? `₹${(kpis.shortfallTD / 100000).toFixed(2)} L`
                : `₹${Math.round(Math.abs(kpis.shortfallTD)).toLocaleString()}`
              }
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Monthly Shortfall</p>
            <p className={cn(
              "text-xl font-black",
              kpis.monthlyShortfall > 0 ? "text-rose-600" : "text-emerald-600"
            )}>
              {kpis.monthlyShortfall >= 100000
                ? `₹${(kpis.monthlyShortfall / 100000).toFixed(2)} L`
                : `₹${Math.round(Math.abs(kpis.monthlyShortfall)).toLocaleString()}`
              }
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Projected Closing</p>
            <p className="text-xl font-black text-slate-900">
              ₹{Math.round(kpis.projectedClosing).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Asking Rate</p>
            <p className="text-xl font-black text-slate-900">
              {kpis.askingRate >= 100000
                ? `₹${(kpis.askingRate / 100000).toFixed(2)} L`
                : `₹${Math.round(kpis.askingRate).toLocaleString()}`
              }
            </p>
          </CardContent>
        </Card>
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
                            <td className="px-4 py-6 text-sm font-bold text-center text-slate-900">{formatCurrency(data[period].cy)}</td>
                            <td className="px-4 py-6 text-sm font-medium text-center text-slate-400">{formatCurrency(data[period].ly)}</td>
                            <td className={cn(
                              "px-4 py-6 text-sm font-black text-center border-r border-slate-50 last:border-r-0",
                              data[period].growth >= 0 ? "text-green-600" : "text-rose-600"
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
              <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Load Growth</CardTitle>
              <BarChart3 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{formatGrowth(growthContribution.load.value)}</div>
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