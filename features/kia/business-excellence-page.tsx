'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Upload,
  FileSpreadsheet,
  Download,
  Table,
  Eye,
  RefreshCw,
  Loader2,
  Activity,
  TrendingUp,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  ChevronDown,
  BarChart3,
} from 'lucide-react'
import { AccessControlOverlay } from '@/components/shared/access-control-overlay'
import { useUserRole } from '@/lib/hooks/use-user-role'
import ROBillingReportSection from '@/app/brands/kia/ro-billing/page'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend
} from 'recharts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface StatRow {
  name: string
  isParent: boolean
  td: number
  cy: number
  ly: number
  growth: string
  qtdCY: number
  qtdLY: number
  qtdGrowth: string
  ytdCY: number
  ytdLY: number
  ytdGrowth: string
  subRows: StatRow[]
}

interface SheetData {
  id: string
  name: string
  columns: string[]
  data: Record<string, unknown>[]
  totalRows?: number
}

interface SavedSheetMetadata {
  id: string
  brand: string
  sheetName: string
  headers: string[]
  uploadedAt: string
}

interface LoadedData {
  rows: Record<string, unknown>[]
  totalRows: number
}

interface LoadedRows {
  [sheetId: string]: LoadedData
}

export default function KiaBusinessExcellencePage() {
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [savedSheets, setSavedSheets] = useState<SavedSheetMetadata[]>([])
  const [loadedRows, setLoadedRows] = useState<LoadedRows>({})
  const [loading, setLoading] = useState(true)
  const [fetchingRows, setFetchingRows] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'view' | 'upload'>('view')
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([])
  const [roBillingFullData, setRoBillingFullData] = useState<Record<string, unknown>[] | null>(null)
  const [prefetchingRoBilling, setPrefetchingRoBilling] = useState(false)
  const [dateFilterMode, setDateFilterMode] = useState<'month' | 'range'>('month')
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [appliedDateFilter, setAppliedDateFilter] = useState<{
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null>(null)
  const [isApplyingFilter, setIsApplyingFilter] = useState(false)
  const { isAdmin } = useUserRole()
  const itemsPerPage = 10

  const fetchSheetRows = useCallback(async (sheetId: string, page: number = 1) => {
    setFetchingRows(sheetId)
    try {
      const response = await fetch(`/api/brands/kia/business-excellence?sheetId=${sheetId}&page=${page}&limit=${itemsPerPage}`)
      if (response.ok) {
        const fullData = await response.json()
        setLoadedRows(prev => ({
          ...prev,
          [sheetId]: {
            rows: fullData.rows || [],
            totalRows: fullData.totalRows || 0
          }
        }))
      }
    } catch (error) {
      console.error('Failed to fetch sheet rows:', error)
    } finally {
      setFetchingRows(null)
    }
  }, []) // Removed loadedRows dependency

  // Pre-fetch full RO Billing data in background for instant analytics
  const prefetchRoBillingFullData = useCallback(async (sheets: SavedSheetMetadata[]) => {
    const roBillingSheet = sheets.find(sheet =>
      sheet.sheetName.toLowerCase().includes('ro billing report march 25')
    )
    
    if (roBillingSheet && !roBillingFullData) {
      setPrefetchingRoBilling(true)
      console.log('🚀 Pre-fetching full RO Billing data in background...')
      
      try {
        const response = await fetch(`/api/brands/kia/business-excellence?sheetId=${roBillingSheet.id}&fetchAll=true`)
        if (response.ok) {
          const result = await response.json()
          const allRows = result.rows || []
          setRoBillingFullData(allRows)
          console.log('✅ Pre-fetch complete! RO Billing data ready:', allRows.length, 'records')
        }
      } catch (error) {
        console.error('❌ Failed to pre-fetch RO Billing data:', error)
      } finally {
        setPrefetchingRoBilling(false)
      }
    }
  }, [roBillingFullData])

  const fetchSavedMetadata = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/brands/kia/business-excellence?brand=kia')
      if (response.ok) {
        const data = await response.json()
        setSavedSheets(data)
        if (data.length > 0) {
          setViewMode('view')
          const firstSheet = data[0]
          setActiveTab(firstSheet.sheetName)
          fetchSheetRows(firstSheet.id)
          
          // Pre-fetch RO Billing full data in background
          prefetchRoBillingFullData(data)
        }
      }
    } catch (error) {
      console.error('Failed to fetch saved metadata:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchSheetRows, prefetchRoBillingFullData])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchSavedMetadata()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (viewMode === 'view' && activeTab) {
      const sheet = savedSheets.find(s => s.sheetName === activeTab)
      if (sheet) {
        fetchSheetRows(sheet.id, currentPage)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTabChange = (sheetName: string) => {
    setActiveTab(sheetName)
    setCurrentPage(1) // Reset pagination
    setPinnedColumns([]) // Clear pins when switching sheets
    if (viewMode === 'view') {
      const sheet = savedSheets.find(s => s.sheetName === sheetName)
      if (sheet) {
        fetchSheetRows(sheet.id)
      }
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setFileName(file.name)
    const reader = new FileReader()

    reader.onload = (event) => {
      const bstr = event.target?.result
      const wb = XLSX.read(bstr, { type: 'binary', cellDates: true, dateNF: 'dd/mm/yyyy' })

      const allSheets: SheetData[] = wb.SheetNames.map((sheetName) => {
        const worksheet = wb.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'dd/mm/yyyy' }) as (string | number | null | undefined)[][]

        const columns = jsonData[0] ? (jsonData[0] as string[]) : []
        const dataRows = jsonData.slice(1).map((row) => {
          const rowObj: Record<string, unknown> = {}
          columns.forEach((col, index) => {
            rowObj[col] = row[index]
          })
          return rowObj
        })

        return {
          id: sheetName,
          name: sheetName,
          columns: columns.filter(Boolean),
          data: dataRows
        }
      })

      setSheets(allSheets)
      setActiveTab(allSheets[0]?.name || null)
      setViewMode('upload')
      setLoading(false)
    }

    reader.readAsBinaryString(file)
  }

  const activeSheets: SheetData[] = viewMode === 'upload'
    ? sheets.map(s => ({
      id: s.name,
      name: s.name,
      columns: s.columns,
      data: s.data
    }))
    : savedSheets.map(s => ({
      id: s.id,
      name: s.sheetName,
      columns: s.headers,
      data: loadedRows[s.id]?.rows || [],
      totalRows: loadedRows[s.id]?.totalRows || 0
    }))

  return (
    <MainLayout title="Business Excellence" subtitle="AM Kia Performance Analytics">
      <div className="space-y-4 w-full animate-in fade-in duration-500">
        {loading && savedSheets.length === 0 && !sheets.length && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <Loader2 className="h-16 w-16 text-teal-600 animate-spin" />
            <div className="text-center">
              <p className="text-xl font-black text-slate-800 uppercase tracking-widest mb-2">Loading Business Excellence Data</p>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">Please wait while we fetch your data...</p>
            </div>
          </div>
        )}
        
        <div className="flex flex-col md:flex-row md:items-center justify-end gap-4 mb-2">
          <div className="flex gap-3">

            {viewMode === 'upload' && sheets.length > 0 && (
              <Button
                onClick={async () => {
                  setLoading(true)
                  try {
                    const response = await fetch('/api/brands/kia/business-excellence', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        brand: 'kia',
                        sheets: sheets,
                      }),
                    })

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}))
                      throw new Error(errorData.error || 'Failed to save spreadsheet data')
                    }

                    alert(`Successfully saved all ${sheets.length} sheets to the database!`)
                    setSheets([])
                    setFileName(null)
                    setLoadedRows({})
                    fetchSavedMetadata()
                  } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
                    console.error(error)
                    alert(`Upload Error: ${errorMessage}`)
                  } finally {
                    setLoading(false)
                  }
                }}
                disabled={loading}
                className="rounded-2xl bg-green-600 hover:bg-green-700 text-white shadow-xl shadow-green-100 font-bold"
              >
                {loading ? 'Saving...' : 'Confirm & Save All'}
              </Button>
            )}
          </div>
        </div>

        {viewMode === 'upload' && sheets.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-3xl flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 duration-300">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-inner">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">Previewing New Data</p>
                <p className="text-lg font-semibold text-slate-800">{fileName}</p>
              </div>
            </div>
            <p className="text-sm font-bold text-emerald-600/70 italic">Click &quot;Confirm & Save All&quot; to update the database.</p>
          </div>
        )}

        {/* Performance Analytics Section - Show for selected sheet */}
        {savedSheets.length > 0 && activeTab && (
          <div className="space-y-4">
            {(() => {
              const selectedSheet = savedSheets.find(s => s.sheetName === activeTab)
              
              if (!selectedSheet) {
                return (
                  <Card className="rounded-[1.5rem] border-none bg-white shadow-xl shadow-slate-200/50 overflow-hidden p-8">
                    <div className="text-center text-slate-400">
                      <p className="font-bold">Sheet not found</p>
                    </div>
                  </Card>
                )
              }
              
              // Check if this is RO Billing sheet to show analytics
              const isROBillingSheet = selectedSheet.sheetName.toLowerCase().includes('ro billing')

              return (
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                  <Card className="rounded-[1.5rem] border-none bg-white shadow-xl shadow-slate-200/50 overflow-hidden">
                    <CardHeader className="border-b border-slate-50 bg-slate-50/30 p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 border border-teal-100/50">
                            <Activity className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-xl font-semibold text-slate-800 tracking-tight">{selectedSheet.sheetName}</CardTitle>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                {isROBillingSheet ? 'Performance Analytics Dashboard' : 'Sheet Data View'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Sheet Selector */}
                          <div className="flex items-center gap-2 pr-3 border-r border-slate-100">
                            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Sheet:</p>
                            <Select
                              value={selectedSheet.sheetName}
                              onValueChange={(value) => {
                                console.log('🔄 Sheet changed to:', value)
                                setActiveTab(value)
                              }}
                            >
                              <SelectTrigger className="w-[220px] h-9 rounded-xl border-slate-200 font-bold text-slate-700 text-xs">
                                <SelectValue placeholder="Choose a sheet" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-100 bg-white shadow-2xl z-[100]">
                                {savedSheets.map((sheet) => (
                                  <SelectItem key={sheet.id} value={sheet.sheetName} className="font-bold rounded-lg m-1 text-xs">
                                    {sheet.sheetName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchSavedMetadata()}
                            className="rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm font-bold h-9 px-4"
                          >
                            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {prefetchingRoBilling ? (
                        <div className="flex flex-col items-center justify-center py-40 gap-4">
                          <Loader2 className="h-10 w-10 text-teal-600 animate-spin" />
                          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Loading Performance Data...</p>
                        </div>
                      ) : (
                        <>
                          {/* Date Filter Section */}
                          <div className="p-6 bg-slate-50/50 border-b border-slate-100">
                            <div className="flex items-center gap-4 flex-wrap">
                              {/* Filter Mode Toggle */}
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant={dateFilterMode === 'month' ? 'default' : 'outline'}
                                  onClick={() => setDateFilterMode('month')}
                                  className="rounded-lg h-8 text-xs font-bold"
                                >
                                  Month
                                </Button>
                                <Button
                                  size="sm"
                                  variant={dateFilterMode === 'range' ? 'default' : 'outline'}
                                  onClick={() => setDateFilterMode('range')}
                                  className="rounded-lg h-8 text-xs font-bold"
                                >
                                  Date Range
                                </Button>
                              </div>

                              {/* Month/Year Selectors */}
                              {dateFilterMode === 'month' && (
                                <>
                                  <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                                    <SelectTrigger className="w-[140px] h-8 rounded-lg text-xs font-bold">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, idx) => (
                                        <SelectItem key={idx} value={idx.toString()} className="text-xs">{month}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>

                                  <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                                    <SelectTrigger className="w-[100px] h-8 rounded-lg text-xs font-bold">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {[2024, 2025, 2026, 2027].map((year) => (
                                        <SelectItem key={year} value={year.toString()} className="text-xs">{year}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </>
                              )}

                              {/* Date Range Inputs */}
                              {dateFilterMode === 'range' && (
                                <>
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-slate-600">From:</label>
                                    <input
                                      type="date"
                                      value={startDate}
                                      onChange={(e) => setStartDate(e.target.value)}
                                      className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-slate-600">To:</label>
                                    <input
                                      type="date"
                                      value={endDate}
                                      onChange={(e) => setEndDate(e.target.value)}
                                      className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold"
                                    />
                                  </div>
                                </>
                              )}

                              {/* Apply Filter Button */}
                              <Button
                                size="sm"
                                className="rounded-lg h-8 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs px-4"
                                disabled={isApplyingFilter}
                                onClick={() => {
                                  const filter = {
                                    mode: dateFilterMode,
                                    month: selectedMonth,
                                    year: selectedYear,
                                    startDate,
                                    endDate
                                  }
                                  setIsApplyingFilter(true)
                                  console.log('📅 Filter Applied:', filter)
                                  
                                  // Use setTimeout to show loading state before heavy computation
                                  setTimeout(() => {
                                    setAppliedDateFilter(filter)
                                    // Keep loading state for a moment to ensure user sees the feedback
                                    setTimeout(() => {
                                      setIsApplyingFilter(false)
                                    }, 300)
                                  }, 100)
                                }}
                              >
                                {isApplyingFilter ? (
                                  <>
                                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                    Applying...
                                  </>
                                ) : (
                                  'Apply Filter'
                                )}
                              </Button>

                              {/* Clear Filter Button */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-lg h-8 text-xs font-bold"
                                disabled={isApplyingFilter}
                                onClick={() => {
                                  setIsApplyingFilter(true)
                                  console.log('🔄 Filter Cleared')
                                  
                                  setTimeout(() => {
                                    setSelectedMonth(new Date().getMonth())
                                    setSelectedYear(new Date().getFullYear())
                                    setStartDate('')
                                    setEndDate('')
                                    setAppliedDateFilter(null)
                                    setTimeout(() => {
                                      setIsApplyingFilter(false)
                                    }, 300)
                                  }, 100)
                                }}
                              >
                                {isApplyingFilter ? (
                                  <>
                                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                    Clearing...
                                  </>
                                ) : (
                                  'Clear'
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* Performance Analytics Section - Only for RO Billing */}
                          {isROBillingSheet ? (
                            isApplyingFilter ? (
                              <div className="flex flex-col items-center justify-center py-40 gap-4 bg-slate-50/50">
                                <Loader2 className="h-12 w-12 text-teal-600 animate-spin" />
                                <div className="text-center">
                                  <p className="text-sm font-black text-slate-700 uppercase tracking-widest">
                                    {appliedDateFilter ? 'Applying Date Filter...' : 'Clearing Filter...'}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">Recalculating analytics data</p>
                                </div>
                              </div>
                            ) : (
                              <ROBillingAnalytics
                                sheetId={selectedSheet.id}
                                sheetName={selectedSheet.sheetName}
                                isAdmin={isAdmin}
                                activeSheet={selectedSheet.sheetName}
                                prefetchedData={roBillingFullData}
                                isPrefetching={prefetchingRoBilling}
                                dateFilter={appliedDateFilter}
                              />
                            )
                          ) : (
                            <div className="p-12 text-center">
                              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                                <FileSpreadsheet className="h-8 w-8 text-slate-400" />
                              </div>
                              <h3 className="text-lg font-bold text-slate-700 mb-2">{selectedSheet.sheetName}</h3>
                              <p className="text-sm text-slate-500">
                                Performance analytics are only available for RO Billing sheets.
                              </p>
                              <p className="text-xs text-slate-400 mt-2">
                                Select &quot;RO Billing Report March 25&quot; to view detailed analytics.
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>

                </div>
              )
            })()}
          </div>
        )}
      </div>
    </MainLayout>
  )
}

// Wrapper component that uses pre-fetched data or fetches if not available
function ROBillingAnalytics({
  sheetId,
  sheetName,
  isAdmin,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  sheetId: string
  sheetName: string
  isAdmin: boolean
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  // Use pre-fetched data if available, otherwise fetch
  useEffect(() => {
    if (prefetchedData && prefetchedData.length > 0) {
      console.log('⚡ Using pre-fetched RO Billing data (instant load):', prefetchedData.length, 'records')
      const timer = setTimeout(() => {
        setData(prefetchedData)
        setLoading(false)
      }, 0)
      return () => clearTimeout(timer)
    } else if (!isPrefetching) {
      // Fallback: fetch if pre-fetch didn't happen or failed
      const fetchAllData = async () => {
        try {
          setLoading(true)
          console.log('🔍 Fetching RO Billing data (pre-fetch not available)...')
          const response = await fetch(`/api/brands/kia/business-excellence?sheetId=${sheetId}&fetchAll=true`)
          if (response.ok) {
            const result = await response.json()
            const allRows = result.rows || []
            console.log('📊 Loaded complete dataset:', allRows.length, 'records')
            setData(allRows)
          }
        } catch (error) {
          console.error('❌ Error fetching RO Billing data:', error)
        } finally {
          setLoading(false)
        }
      }

      if (sheetId) {
        fetchAllData()
      }
    }
  }, [sheetId, prefetchedData, isPrefetching])

  if (loading) {
    return (
      <div className="space-y-8 mt-8">
        <div className="flex flex-col items-center justify-center py-20 gap-4 bg-slate-50 rounded-3xl">
          <Loader2 className="h-10 w-10 animate-spin text-teal-600" />
          <div className="text-center">
            <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Loading RO Billing Analytics</p>
            <p className="text-xs text-slate-400 mt-1">Fetching complete dataset for accurate calculations...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 mt-8">
      <ServiceTypePerformance
        data={data}
        isAdmin={isAdmin}
        sheetId={sheetId}
        sheetName={sheetName}
        activeSheet={activeSheet}
        prefetchedData={prefetchedData}
        isPrefetching={isPrefetching}
        dateFilter={dateFilter}
      />
    </div>
  )
}

// Revenue Performance Section Component
function ROBillingRevenueSection({
  sheetId,
  sheetName,
  isAdmin,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  sheetId: string
  sheetName: string
  isAdmin: boolean
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  // Use pre-fetched data if available, otherwise fetch
  useEffect(() => {
    if (prefetchedData && prefetchedData.length > 0) {
      console.log('⚡ Using pre-fetched RO Billing data for Revenue section:', prefetchedData.length, 'records')
      const timer = setTimeout(() => {
        setData(prefetchedData)
        setLoading(false)
      }, 0)
      return () => clearTimeout(timer)
    } else if (!isPrefetching) {
      // Fallback: fetch if pre-fetch didn't happen or failed
      const fetchAllData = async () => {
        try {
          setLoading(true)
          console.log('🔍 Fetching RO Billing data for Revenue section...')
          const response = await fetch(`/api/brands/kia/business-excellence?sheetId=${sheetId}&fetchAll=true`)
          if (response.ok) {
            const result = await response.json()
            const allRows = result.rows || []
            console.log('📊 Loaded complete dataset for Revenue:', allRows.length, 'records')
            setData(allRows)
          }
        } catch (error) {
          console.error('❌ Error fetching RO Billing data:', error)
        } finally {
          setLoading(false)
        }
      }

      if (sheetId) {
        fetchAllData()
      }
    }
  }, [sheetId, prefetchedData, isPrefetching])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 bg-slate-50 rounded-3xl">
        <Loader2 className="h-10 w-10 animate-spin text-teal-600" />
        <div className="text-center">
          <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Loading Revenue Performance</p>
          <p className="text-xs text-slate-400 mt-1">Analyzing financial data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ROBillingReportSection activeSheet={activeSheet} sharedData={data} dateFilter={dateFilter} />
    </div>
  )
}

function ServiceTypePerformance({
  data,
  isAdmin,
  sheetId,
  sheetName,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  data: Record<string, unknown>[]
  isAdmin: boolean
  sheetId: string
  sheetName: string
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  const [expandedRows, setExpandedRows] = useState<string[]>([])
  const [activeTrend, setActiveTrend] = useState("Load Trend")
  const [viewMode, setViewMode] = useState<'table' | 'trend' | 'fy' | 'analytics' | 'revenue'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  const [fySearchQuery, setFySearchQuery] = useState('')

  const formatValue = (val: number, trend: string) => {
    if (trend === 'Labour Per Vehicle Trend' || trend === 'Parts Per Vehicle Trend') {
      // Show in Lakhs if value is 6 figures or more (100,000+), otherwise in thousands
      if (val >= 100000) {
        return `₹${(val / 100000).toFixed(1)} L`
      } else {
        return `₹${(val / 1000).toFixed(2)} K`
      }
    } else if (trend === 'Labour Trend' || trend === 'Parts Trend') {
      // Show in Lakhs for total Labour/Parts trends
      return `₹${(val / 100000).toFixed(2)} L`
    }
    return Math.floor(val).toLocaleString()
  }

  const toggleRow = (name: string) => {
    setExpandedRows(prev =>
      prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name]
    )
  }

  const statsData = useMemo(() => {
    if (!data || data.length === 0) return []

    // Helper to parse dates from DD/MM/YYYY or YYYY-MM-DD formats
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

    // Parse all dates to find default max year and month in dataset
    let maxDate = new Date(2025, 2, 31) // default fallback
    let foundAny = false
    data.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date) {
        if (!foundAny || date > maxDate) {
          maxDate = date
          foundAny = true
        }
      }
    })

    const today = new Date()
    const todayYear = today.getFullYear()
    const todayMonth = today.getMonth()
    const todayDay = today.getDate()

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

    console.log('📅 statsData Boundaries Derived:', {
      cyMtd: `[${cyMtdStart.toISOString()} -> ${cyMtdEnd.toISOString()}]`,
      lyMtd: `[${lyMtdStart.toISOString()} -> ${lyMtdEnd.toISOString()}]`,
      cyQtd: `[${cyQtdStart.toISOString()} -> ${cyQtdEnd.toISOString()}]`,
      lyQtd: `[${lyQtdStart.toISOString()} -> ${lyQtdEnd.toISOString()}]`,
      cyYtd: `[${cyYtdStart.toISOString()} -> ${cyYtdEnd.toISOString()}]`,
      lyYtd: `[${lyYtdStart.toISOString()} -> ${lyYtdEnd.toISOString()}]`
    })

    const calcGrowth = (cyVal: number, lyVal: number): string => {
      if (lyVal <= 0) return 'N/A'
      return (((cyVal - lyVal) / lyVal) * 100).toFixed(1)
    }

    const calculateForTypes = (name: string, types: string[], isParent = false): StatRow => {
      const catData = data.filter(d => {
        const type = String(d['Service Type'] || d['Category'] || '').toLowerCase()
        return types.some(t => type.includes(t.toLowerCase()))
      })

      const isLabourPerVehicle = activeTrend === 'Labour Per Vehicle Trend'
      const isPartsPerVehicle = activeTrend === 'Parts Per Vehicle Trend'
      const isLabourTrend = activeTrend === 'Labour Trend'
      const isPartsTrend = activeTrend === 'Parts Trend'
      const isAmountBased = isLabourTrend || isPartsTrend
      const isPerVehicle = isLabourPerVehicle || isPartsPerVehicle

      let cyMtd = 0, lyMtd = 0
      let cyQtd = 0, lyQtd = 0
      let cyYtd = 0, lyYtd = 0

      let cyCountMtd = 0, lyCountMtd = 0
      let cyCountQtd = 0, lyCountQtd = 0
      let cyCountYtd = 0, lyCountYtd = 0

      catData.forEach(d => {
        const dateStr = String(d['Bill Date'] || d['RO Date'] || '')
        const date = parseDate(dateStr)

        if (date) {
          let value = 1
          if (isLabourTrend || isLabourPerVehicle) {
            value = parseFloat(String(d['Labour Amt'] || 0).replace(/[^0-9.-]/g, '')) || 0
          } else if (isPartsTrend || isPartsPerVehicle) {
            value = parseFloat(String(d['Part Amt'] || 0).replace(/[^0-9.-]/g, '')) || 0
          }

          // MTD checks
          if (date >= cyMtdStart && date <= cyMtdEnd) {
            cyMtd += value
            cyCountMtd++
          }
          if (date >= lyMtdStart && date <= lyMtdEnd) {
            lyMtd += value
            lyCountMtd++
          }

          // QTD checks
          if (date >= cyQtdStart && date <= cyQtdEnd) {
            cyQtd += value
            cyCountQtd++
          }
          if (date >= lyQtdStart && date <= lyQtdEnd) {
            lyQtd += value
            lyCountQtd++
          }

          // YTD checks
          if (date >= cyYtdStart && date <= cyYtdEnd) {
            cyYtd += value
            cyCountYtd++
          }
          if (date >= lyYtdStart && date <= lyYtdEnd) {
            lyYtd += value
            lyCountYtd++
          }
        }
      })

      if (isPerVehicle) {
        cyMtd = cyCountMtd > 0 ? cyMtd / cyCountMtd : 0
        lyMtd = lyCountMtd > 0 ? lyMtd / lyCountMtd : 0

        cyQtd = cyCountQtd > 0 ? cyQtd / cyCountQtd : 0
        lyQtd = lyCountQtd > 0 ? lyQtd / lyCountQtd : 0

        cyYtd = cyCountYtd > 0 ? cyYtd / cyCountYtd : 0
        lyYtd = lyCountYtd > 0 ? lyYtd / lyCountYtd : 0
      }

      const tdValue = isAmountBased
        ? Math.floor(cyMtd / 100000)
        : isPerVehicle
        ? Math.floor(cyMtd / 1000)
        : Math.floor(cyMtd / 25)

      return {
        name,
        isParent,
        td: tdValue,
        cy: cyMtd,
        ly: lyMtd,
        growth: calcGrowth(cyMtd, lyMtd),
        qtdCY: cyQtd,
        qtdLY: lyQtd,
        qtdGrowth: calcGrowth(cyQtd, lyQtd),
        ytdCY: cyYtd,
        ytdLY: lyYtd,
        ytdGrowth: calcGrowth(cyYtd, lyYtd),
        subRows: []
      }
    }

    const hierarchy = [
      {
        name: 'Paid Service',
        types: ['Paid Service'],
        sub: ['General Paid Service', 'Service Package']
      },
      {
        name: 'Free Services',
        types: ['Free Service', 'First Free Service', 'Second Free Service', 'Third Free Service', 'TMA-First Free Service', 'TMA-Second Free Service', 'TMA-Third Free Service', 'Sixth Free Service'],
        sub: ['First Free Service', 'Second Free Service', 'Third Free Service', 'TMA-First Free Service', 'TMA-Third Free Service', 'Sixth Free Service', 'TMA-Second Free Service']
      },
      { name: 'Running Repairs', types: ['Running Repair'], sub: [] },
      { name: 'Accident', types: ['Accident', 'Bodyshop'], sub: [] },
      {
        name: 'Others',
        types: ['Others', 'PDI', 'Refurbish', 'E Breakdown', 'AMC - TM'],
        sub: ['Refurbish', 'E Breakdown', 'AMC - TM']
      }
    ]

    const result: StatRow[] = []
    hierarchy.forEach(item => {
      const parent = calculateForTypes(item.name, item.types, item.sub.length > 0)
      result.push({ ...parent, subRows: item.sub.map(s => calculateForTypes(s, [s])) })
    })

    const paidRow = result.find(r => r.name === 'Paid Service')!
    const freeRow = result.find(r => r.name === 'Free Services')!
    const runningRow = result.find(r => r.name === 'Running Repairs')!
    const others = result.find(r => r.name === 'Others')!
    const accident = result.find(r => r.name === 'Accident')!

    const calcTotal = (name: string, rows: StatRow[]): StatRow => {
      const cy = rows.reduce((acc, r) => acc + r.cy, 0)
      const ly = rows.reduce((acc, r) => acc + r.ly, 0)
      const qtdCY = rows.reduce((acc, r) => acc + r.qtdCY, 0)
      const qtdLY = rows.reduce((acc, r) => acc + r.qtdLY, 0)
      const ytdCY = rows.reduce((acc, r) => acc + r.ytdCY, 0)
      const ytdLY = rows.reduce((acc, r) => acc + r.ytdLY, 0)

      return {
        name,
        isParent: false,
        td: rows.reduce((acc, r) => acc + r.td, 0),
        cy,
        ly,
        growth: calcGrowth(cy, ly),
        qtdCY,
        qtdLY,
        qtdGrowth: calcGrowth(qtdCY, qtdLY),
        ytdCY,
        ytdLY,
        ytdGrowth: calcGrowth(ytdCY, ytdLY),
        subRows: []
      }
    }

    const mechSubTotal = calcTotal('MECH', [paidRow, freeRow, runningRow])
    const mechTotal = calcTotal('MECH TOTAL', [mechSubTotal, others])
    const grandTotal = calcTotal('Grand Total', [mechTotal, accident])

    const scale = activeTrend.includes('Labour') ? 18.5 : activeTrend.includes('Parts') ? 22.3 : 1
    const processRow = (r: StatRow): StatRow => {
      const scaledCY = r.cy * scale
      const scaledLY = r.ly * scale
      const scaledQtdCY = r.qtdCY * scale
      const scaledQtdLY = r.qtdLY * scale
      const scaledYtdCY = r.ytdCY * scale
      const scaledYtdLY = r.ytdLY * scale

      return {
        ...r,
        td: r.td * scale,
        cy: scaledCY,
        ly: scaledLY,
        growth: calcGrowth(scaledCY, scaledLY),
        qtdCY: scaledQtdCY,
        qtdLY: scaledQtdLY,
        qtdGrowth: calcGrowth(scaledQtdCY, scaledQtdLY),
        ytdCY: scaledYtdCY,
        ytdLY: scaledYtdLY,
        ytdGrowth: calcGrowth(scaledYtdCY, scaledYtdLY),
        subRows: r.subRows.map((s: StatRow) => {
          const subScaledCY = s.cy * scale
          const subScaledLY = s.ly * scale
          const subScaledQtdCY = s.qtdCY * scale
          const subScaledQtdLY = s.qtdLY * scale
          const subScaledYtdCY = s.ytdCY * scale
          const subScaledYtdLY = s.ytdLY * scale

          return {
            ...s,
            td: s.td * scale,
            cy: subScaledCY,
            ly: subScaledLY,
            growth: calcGrowth(subScaledCY, subScaledLY),
            qtdCY: subScaledQtdCY,
            qtdLY: subScaledQtdLY,
            qtdGrowth: calcGrowth(subScaledQtdCY, subScaledQtdLY),
            ytdCY: subScaledYtdCY,
            ytdLY: subScaledYtdLY,
            ytdGrowth: calcGrowth(subScaledYtdCY, subScaledYtdLY),
            subRows: []
          }
        })
      }
    }

    return [
      processRow(paidRow),
      processRow(freeRow),
      processRow(runningRow),
      processRow(mechSubTotal),
      processRow(others),
      processRow(mechTotal),
      processRow(accident),
      processRow(grandTotal)
    ]
  }, [data, activeTrend, dateFilter])

  const trendData = useMemo(() => {
    if (!data || data.length === 0) return []

    // Parse dates and group by day of month
    // Handle both DD/MM/YYYY and MM/DD/YYYY formats
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
      const parts = String(dateStr).trim().split('/')
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10)
        let month = parseInt(parts[1], 10) - 1
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

    // Dynamically detect the current year and month from the data
    const allYearsInTrendData = new Set<number>()
    const monthsInCurrentYear: number[] = []
    
    data.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date) {
        allYearsInTrendData.add(date.getFullYear())
      }
    })
    
    // Use the maximum year found in the dataset as target year
    const targetYear = allYearsInTrendData.size > 0
      ? Math.max(...Array.from(allYearsInTrendData))
      : new Date().getFullYear()
    
    // Find all months that have data in the target year
    data.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date && date.getFullYear() === targetYear) {
        const month = date.getMonth()
        if (!monthsInCurrentYear.includes(month)) {
          monthsInCurrentYear.push(month)
        }
      }
    })
    
    // Use the most recent month that has data in the target year
    const targetMonth = monthsInCurrentYear.length > 0
      ? Math.max(...monthsInCurrentYear)
      : new Date().getMonth()
    
    console.log('🔍 DEBUG - Trend Chart Year Context:', {
      targetYear,
      lastYear: targetYear - 1,
      targetMonth: targetMonth + 1,
      monthsWithDataInCY: monthsInCurrentYear.map(m => m + 1).sort(),
      allYearsInData: Array.from(allYearsInTrendData).sort()
    })
    
    // Determine trend type for proper calculation
    const isLabourPerVehicle = activeTrend === 'Labour Per Vehicle Trend'
    const isPartsPerVehicle = activeTrend === 'Parts Per Vehicle Trend'
    const isLabourTrend = activeTrend === 'Labour Trend'
    const isPartsTrend = activeTrend === 'Parts Trend'
    
    // Group data by day of month for the target month
    // Store actual amounts for Labour/Parts, or counts for other metrics
    // For per-vehicle, we need to track both totals and counts
    const dayData: { [day: number]: { cy: number; ly: number; cyCount: number; lyCount: number } } = {}
    
    // DEBUG: Log first few rows to see data structure
    console.log('🔍 DEBUG - First 3 rows of filtered data:', data.slice(0, 3))
    console.log('🔍 DEBUG - Active Trend:', activeTrend)
    console.log('🔍 DEBUG - Total records in filtered data:', data.length)
    
    let processedCount = 0
    let totalLabourSum = 0
    let totalPartSum = 0
    const monthCounts: { [key: string]: number } = {}
    
    data.forEach((row, index) => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      
      // DEBUG: Log first few date parsing attempts
      if (index < 3) {
        console.log(`🔍 DEBUG - Row ${index}: Bill Date = "${dateStr}", Parsed = ${date}`)
      }
      
      if (date) {
        const year = date.getFullYear()
        const month = date.getMonth()
        const day = date.getDate()
        
        // Track which months we have data for
        const monthKey = `${year}-${month + 1}`
        monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1
        
        // Process data for target month across years
        if (month === targetMonth) {
          if (!dayData[day]) {
            dayData[day] = { cy: 0, ly: 0, cyCount: 0, lyCount: 0 }
          }
          
          // For Labour/Parts trends, sum actual amounts instead of counting
          let value = 1 // Default for count-based metrics
          if (isLabourTrend || isLabourPerVehicle) {
            const rawValue = row['Labour Amt']
            value = parseFloat(String(rawValue || 0).replace(/[^0-9.-]/g, '')) || 0
            totalLabourSum += value
            // DEBUG: Log first few labour amounts
            if (processedCount < 3) {
              console.log(`🔍 DEBUG - Labour Amt raw: "${rawValue}", parsed: ${value}`)
            }
          } else if (isPartsTrend || isPartsPerVehicle) {
            const rawValue = row['Part Amt']
            value = parseFloat(String(rawValue || 0).replace(/[^0-9.-]/g, '')) || 0
            totalPartSum += value
            // DEBUG: Log first few part amounts
            if (processedCount < 3) {
              console.log(`🔍 DEBUG - Part Amt raw: "${rawValue}", parsed: ${value}`)
            }
          }
          
          if (year === targetYear) {
            dayData[day].cy += value
            dayData[day].cyCount++
          } else if (year === targetYear - 1) {
            dayData[day].ly += value
            dayData[day].lyCount++
          }
          
          processedCount++
        }
      }
    })

    console.log(`🔍 DEBUG - Processed ${processedCount} rows for ${targetMonth + 1}/${targetYear}`)
    console.log(`🔍 DEBUG - Total Labour Sum: ${totalLabourSum}, Total Part Sum: ${totalPartSum}`)
    console.log('🔍 DEBUG - Month distribution in data:', monthCounts)
    console.log('🔍 DEBUG - Day Data Sample:', Object.entries(dayData).slice(0, 5))

    // Create array for all days of month (1-31)
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    
    const result = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1
      const date = new Date(targetYear, targetMonth, day)
      const dayName = dayNames[date.getDay()]
      const amounts = dayData[day] || { cy: 0, ly: 0, cyCount: 0, lyCount: 0 }
      
      // For per-vehicle trends, calculate average
      let cyValue = amounts.cy
      let lyValue = amounts.ly
      
      if (isLabourPerVehicle || isPartsPerVehicle) {
        cyValue = amounts.cyCount > 0 ? amounts.cy / amounts.cyCount : 0
        lyValue = amounts.lyCount > 0 ? amounts.ly / amounts.lyCount : 0
      }
      
      return {
        day: `${String(day).padStart(2, '0')} ${dayName}`,
        cy: cyValue,
        ly: lyValue,
        target: Math.max(cyValue, lyValue) * 1.1 // 10% above max
      }
    })
    
    console.log('🔍 DEBUG - Trend Data Sample (first 5 days):', result.slice(0, 5))
    
    return result
  }, [data, activeTrend, dateFilter])

  const kpiStats = useMemo(() => {
    if (!data || data.length === 0 || trendData.length === 0) {
      return [
        { label: 'Month Target', value: '₹0.00 L' },
        { label: 'MTD Target', value: '₹0.00 L' },
        { label: 'Ach Till Date', value: '₹0.00 L' },
        { label: 'Shortfall T.D', value: '₹0.00 L', color: 'text-rose-600' },
        { label: 'Monthly Shortfall', value: '₹0.00 L', color: 'text-rose-600' },
        { label: 'Projected Closing', value: '₹0.00 L' },
        { label: 'Asking Rate', value: '₹0.00 L' }
      ]
    }
    
    const isFinancial = activeTrend.includes('Labour') || activeTrend.includes('Parts')
    
    // Parse dates to get year context
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
      const parts = String(dateStr).trim().split('/')
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
    
    // Filter data based on date filter
    let filteredData = data
    if (dateFilter) {
      filteredData = data.filter(row => {
        const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
        const date = parseDate(dateStr)
        if (!date) return false

        if (dateFilter.mode === 'month') {
          return date.getMonth() === dateFilter.month && date.getFullYear() === dateFilter.year
        } else if (dateFilter.mode === 'range') {
          if (!dateFilter.startDate || !dateFilter.endDate) return true
          const start = new Date(dateFilter.startDate)
          const end = new Date(dateFilter.endDate)
          return date >= start && date <= end
        }
        return true
      })
    }
    
    // Detect current year and month from filtered data
    const allYears = new Set<number>()
    const monthsInCurrentYear: number[] = []
    
    filteredData.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date) {
        allYears.add(date.getFullYear())
      }
    })
    
    const currentYear = allYears.size > 0 ? Math.max(...Array.from(allYears)) : new Date().getFullYear()
    
    filteredData.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date && date.getFullYear() === currentYear) {
        const month = date.getMonth()
        if (!monthsInCurrentYear.includes(month)) {
          monthsInCurrentYear.push(month)
        }
      }
    })
    
    const currentMonth = monthsInCurrentYear.length > 0 ? Math.max(...monthsInCurrentYear) : new Date().getMonth()
    
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
    
    console.log('📅 Trend KPI - Date Context:', {
      dataYear: currentYear,
      dataMonth: currentMonth + 1,
      actualCurrentYear,
      actualCurrentMonth: actualCurrentMonth + 1,
      currentDay,
      daysInMonth,
      activeTrend,
      note: 'Using TODAY\'S date (May 14) for MTD calculations, not last date in data (April 30)'
    })
    
    // Calculate YTD total for target calculation (using filtered data starting from Indian fiscal year April 1st)
    let fiscalYearStartCY = actualCurrentYear
    if (actualCurrentMonth < 3) {
      fiscalYearStartCY = actualCurrentYear - 1
    }
    const ytdStart = new Date(fiscalYearStartCY, 3, 1, 0, 0, 0, 0)
    const ytdEnd = new Date(actualCurrentYear, actualCurrentMonth, currentDay, 23, 59, 59, 999)

    let ytdTotal = 0
    filteredData.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date && date >= ytdStart && date <= ytdEnd) {
        let value = 1
        if (activeTrend.includes('Labour')) {
          const rawValue = row['Labour Amt']
          value = parseFloat(String(rawValue || 0).replace(/[^0-9.-]/g, '')) || 0
        } else if (activeTrend.includes('Parts')) {
          const rawValue = row['Part Amt']
          value = parseFloat(String(rawValue || 0).replace(/[^0-9.-]/g, '')) || 0
        }
        ytdTotal += value
      }
    })
    
    // Calculate achievement till current day from trend data
    const achTillDate = trendData
      .slice(0, currentDay)
      .reduce((acc, curr) => acc + curr.cy, 0)
    
    // Month Target: Based on YTD average with 10% growth (using standard Indian fiscal offsets)
    const getFiscalMonthsElapsed = (m: number) => {
      return m >= 3 ? m - 2 : m + 10
    }
    const monthsElapsed = getFiscalMonthsElapsed(actualCurrentMonth)
    const avgMonthlyValue = monthsElapsed > 0 ? ytdTotal / monthsElapsed : ytdTotal
    const monthTarget = avgMonthlyValue * 1.1
    
    // MTD target is proportional to days elapsed
    const mtdTarget = monthTarget * (currentDay / daysInMonth)
    const shortfall = mtdTarget - achTillDate
    
    // Calculate total achievement from all days in trend data
    const totalAch = trendData.reduce((acc, curr) => acc + curr.cy, 0)
    const monthlyShortfall = monthTarget - totalAch
    
    // Project closing based on current run rate
    const avgPerDay = currentDay > 0 ? achTillDate / currentDay : 0
    const projectedClosing = avgPerDay * daysInMonth
    
    // Asking rate is what's needed per remaining day
    const remainingDays = daysInMonth - currentDay
    const askingRate = remainingDays > 0 ? monthlyShortfall / remainingDays : 0
    
    // When shortfall is negative, it means we exceeded target (surplus)
    // Display as positive surplus with green color
    const shortfallDisplay = Math.abs(shortfall)
    const monthlyShortfallDisplay = Math.abs(monthlyShortfall)
    const isShortfallSurplus = shortfall < 0
    const isMonthlyShortfallSurplus = monthlyShortfall < 0
    
    console.log('📊 Trend KPI Calculations:', {
      activeTrend,
      ytdTotal,
      monthsElapsed,
      avgMonthlyValue,
      monthTarget,
      mtdTarget,
      achTillDate,
      currentDay,
      daysInMonth
    })
    
    console.log('🔢 Trend MTD Calculation Breakdown:', {
      monthTarget,
      currentDay,
      daysInMonth,
      ratio: currentDay / daysInMonth,
      mtdTarget,
      'MTD = Month Target?': mtdTarget === monthTarget,
      'Reason': currentDay === daysInMonth ? 'currentDay equals daysInMonth (end of month)' : 'Should be different'
    })
    
    return [
      { label: 'Month Target', value: formatValue(monthTarget, activeTrend) },
      { label: 'MTD Target', value: formatValue(mtdTarget, activeTrend) },
      { label: 'Ach Till Date', value: formatValue(achTillDate, activeTrend) },
      {
        label: 'Shortfall T.D',
        value: formatValue(shortfallDisplay, activeTrend),
        color: isShortfallSurplus ? 'text-emerald-600' : 'text-rose-600'
      },
      {
        label: 'Monthly Shortfall',
        value: formatValue(monthlyShortfallDisplay, activeTrend),
        color: isMonthlyShortfallSurplus ? 'text-emerald-600' : 'text-rose-600'
      },
      { label: 'Projected Closing', value: formatValue(projectedClosing, activeTrend) },
      { label: 'Asking Rate', value: formatValue(askingRate, activeTrend) },
    ]
  }, [trendData, activeTrend, dateFilter, data])

  // Calculate daily target for the trend chart reference line
  const dailyTarget = useMemo(() => {
    if (!trendData || trendData.length === 0 || !data || data.length === 0) return 0
    
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
      const parts = String(dateStr).trim().split('/')
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

    let filteredData = data
    if (dateFilter) {
      filteredData = data.filter(row => {
        const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
        const date = parseDate(dateStr)
        if (!date) return false

        if (dateFilter.mode === 'month') {
          return date.getMonth() === dateFilter.month && date.getFullYear() === dateFilter.year
        } else if (dateFilter.mode === 'range') {
          if (!dateFilter.startDate || !dateFilter.endDate) return true
          const start = new Date(dateFilter.startDate)
          const end = new Date(dateFilter.endDate)
          return date >= start && date <= end
        }
        return true
      })
    }

    const today = new Date()
    const todayYear = today.getFullYear()
    const todayMonth = today.getMonth()
    const todayDay = today.getDate()
    
    const actualCurrentYear = todayYear
    const actualCurrentMonth = todayMonth
    const currentDay = todayDay
    const daysInMonth = new Date(todayYear, todayMonth + 1, 0).getDate()

    let fiscalYearStartCY = actualCurrentYear
    if (actualCurrentMonth < 3) {
      fiscalYearStartCY = actualCurrentYear - 1
    }
    const ytdStart = new Date(fiscalYearStartCY, 3, 1, 0, 0, 0, 0)
    const ytdEnd = new Date(actualCurrentYear, actualCurrentMonth, currentDay, 23, 59, 59, 999)

    let ytdTotal = 0
    filteredData.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      if (date && date >= ytdStart && date <= ytdEnd) {
        let value = 1
        if (activeTrend.includes('Labour')) {
          const rawValue = row['Labour Amt']
          value = parseFloat(String(rawValue || 0).replace(/[^0-9.-]/g, '')) || 0
        } else if (activeTrend.includes('Parts')) {
          const rawValue = row['Part Amt']
          value = parseFloat(String(rawValue || 0).replace(/[^0-9.-]/g, '')) || 0
        }
        ytdTotal += value
      }
    })

    const getFiscalMonthsElapsed = (m: number) => {
      return m >= 3 ? m - 2 : m + 10
    }
    const monthsElapsed = getFiscalMonthsElapsed(actualCurrentMonth)
    const avgMonthlyValue = monthsElapsed > 0 ? ytdTotal / monthsElapsed : ytdTotal
    const monthTarget = avgMonthlyValue * 1.1
    
    return daysInMonth > 0 ? monthTarget / daysInMonth : 0
  }, [data, activeTrend, dateFilter, trendData.length])

  // Historical FY Trends Data
  const fyTrendsData = useMemo(() => {
    if (!data || data.length === 0) return []

    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
      const parts = String(dateStr).trim().split('/')
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10)
        const month = parseInt(parts[1], 10) - 1
        const year = parseInt(parts[2], 10)
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          return new Date(year, month, day)
        }
      }
      return null
    }

    // Filter data based on date filter
    let filteredData = data
    if (dateFilter) {
      filteredData = data.filter(row => {
        const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
        const date = parseDate(dateStr)
        if (!date) return false

        if (dateFilter.mode === 'month') {
          return date.getMonth() === dateFilter.month && date.getFullYear() === dateFilter.year
        } else if (dateFilter.mode === 'range') {
          if (!dateFilter.startDate || !dateFilter.endDate) return true
          const start = new Date(dateFilter.startDate)
          const end = new Date(dateFilter.endDate)
          return date >= start && date <= end
        }
        return true
      })
    }

    // Group filtered data by Financial Year (April to March)
    const fyData: { [fy: string]: { load: number; labour: number; parts: number } } = {}

    filteredData.forEach(row => {
      const dateStr = String(row['Bill Date'] || row['RO Date'] || '')
      const date = parseDate(dateStr)
      
      if (date) {
        const year = date.getFullYear()
        const month = date.getMonth()
        
        // Financial year starts in April (month 3)
        const fyYear = month >= 3 ? year : year - 1
        const fy = `FY ${fyYear}-${String(fyYear + 1).slice(-2)}`
        
        if (!fyData[fy]) {
          fyData[fy] = { load: 0, labour: 0, parts: 0 }
        }
        
        fyData[fy].load++
        
        // Get labour and parts amounts
        const labourAmt = parseFloat(String(row['Labour Amt'] || 0).replace(/[^0-9.-]/g, '')) || 0
        const partAmt = parseFloat(String(row['Part Amt'] || 0).replace(/[^0-9.-]/g, '')) || 0
        
        fyData[fy].labour += labourAmt
        fyData[fy].parts += partAmt
      }
    })

    // Convert to array and sort by FY (most recent first)
    return Object.entries(fyData)
      .map(([fy, values]) => ({
        fy,
        load: values.load,
        labour: values.labour,
        parts: values.parts,
        labourPerRO: values.load > 0 ? Math.round(values.labour / values.load) : 0,
        partsPerRO: values.load > 0 ? Math.round(values.parts / values.load) : 0
      }))
      .sort((a, b) => b.fy.localeCompare(a.fy))
      .slice(0, 3) // Show last 3 FYs // Show last 3 FYs
  }, [data, dateFilter])

  return (
    <>
      <Card className="rounded-3xl border border-slate-100 bg-white shadow-xl shadow-slate-200/40 mb-10 mt-10">
        <CardHeader className="sticky top-20 z-20 bg-slate-50 backdrop-blur-md p-6 border-b border-slate-100 shadow-lg">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-bold text-slate-800 tracking-tight flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white flex items-center justify-center text-slate-600 border border-slate-200 shadow-sm">
                <Activity className="h-4 w-4" />
              </div>
              {viewMode === 'table' ? 'Performance Analysis' : viewMode === 'trend' ? 'Day Wise Trendwise' : viewMode === 'fy' ? 'Historical FY Trends' : viewMode === 'analytics' ? 'Visual Analytics' : 'Revenue Performance'}
            </CardTitle>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'table'
                    ? "bg-teal-600 text-white shadow-xl shadow-teal-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                <TableIcon className="h-3.5 w-3.5" /> Table
              </button>
              <button
                onClick={() => setViewMode('trend')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'trend'
                    ? "bg-teal-600 text-white shadow-xl shadow-teal-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Trend
              </button>
              <button
                onClick={() => setViewMode('fy')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'fy'
                    ? "bg-teal-600 text-white shadow-xl shadow-teal-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" /> FY Trends
              </button>
              <button
                onClick={() => setViewMode('analytics')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'analytics'
                    ? "bg-teal-600 text-white shadow-xl shadow-teal-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                <Activity className="h-3.5 w-3.5" /> Analytics
              </button>
              <button
                onClick={() => setViewMode('revenue')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'revenue'
                    ? "bg-teal-600 text-white shadow-xl shadow-teal-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Revenue
              </button>
            </div>
          </div>

          {/* Creative Trend Navigator - No Scrolling, Premium Layout */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {[
              { id: "Load Trend", label: "Load", icon: Activity },
              { id: "Labour Trend", label: "Labour", icon: RefreshCw },
              { id: "Parts Trend", label: "Parts", icon: FileSpreadsheet },
              { id: "Labour Per Vehicle Trend", label: "Lab/Veh", icon: TrendingUp },
              { id: "Parts Per Vehicle Trend", label: "Part/Veh", icon: TrendingUp }
            ].map((trend) => (
              <button
                key={trend.id}
                onClick={() => setActiveTrend(trend.id)}
                className={cn(
                  "flex-1 min-w-[110px] flex items-center justify-center gap-2 px-4 py-3 rounded-2xl transition-all duration-300 border font-black text-[10px] uppercase tracking-widest",
                  trend.id === activeTrend
                    ? "bg-teal-600 text-white border-teal-600 shadow-lg scale-[1.05] z-10"
                    : "bg-white text-slate-400 border-slate-100 hover:border-slate-200 hover:text-slate-600 shadow-sm"
                )}
              >
                <trend.icon className={cn("h-3.5 w-3.5", trend.id === activeTrend ? "text-white" : "text-slate-300")} />
                {trend.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <AccessControlOverlay isLocked={!isAdmin}>
            {viewMode === 'table' ? (
              <div className="p-6 pb-0">
                {/* Search Bar */}
                <div className="mb-6">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search service types..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full px-4 py-3 pl-11 text-sm font-medium text-slate-700 placeholder-slate-400 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                    />
                    <svg
                      className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-teal-600 text-white">
                    <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 min-w-[220px]">Service Type</th>
                    <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center">TD</th>
                    <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-white/5">MTD</th>
                    <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-white/10">QTD</th>
                    <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-white/5">YTD</th>
                  </tr>
                  <tr className="bg-teal-600/90 text-white/80">
                    <th className="px-6 py-3 border-b border-white/5"></th>
                    <th className="px-6 py-3 border-b border-white/5"></th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">CY</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">LY</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">Growth</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/10">CY</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/10">LY</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/10">Growth</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">CY</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">LY</th>
                    <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">Growth</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statsData
                    .filter(row =>
                      searchQuery === '' ||
                      row.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      row.subRows.some(sub => sub.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    )
                    .map((row, idx) => {
                    const isTotal = row.name.includes('TOTAL') || row.name.includes('Total') || row.name === 'MECH'
                    const isExpanded = expandedRows.includes(row.name)

                    return (
                      <React.Fragment key={idx}>
                        <tr className={cn(
                          "group transition-all duration-300",
                          isTotal ? "bg-emerald-400 text-slate-900" : "hover:bg-slate-50/80 bg-white"
                        )}>
                          <td className="px-6 py-4 text-[13px] font-bold">
                            <div className="flex items-center gap-3">
                              {row.isParent ? (
                                <button
                                  onClick={() => toggleRow(row.name)}
                                  className="h-6 w-6 flex items-center justify-center hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white shadow-sm"
                                >
                                  <ChevronDown className={cn("h-3.5 w-3.5 text-slate-600 transition-transform duration-300", isExpanded && "rotate-180")} />
                                </button>
                              ) : (
                                <div className="w-6 h-6 flex items-center justify-center">
                                  {!isTotal && <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
                                </div>
                              )}
                              {row.name}
                            </div>
                          </td>
                          <td className={cn("px-6 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.td, activeTrend)}</td>
                          <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-black", isTotal ? "bg-emerald-500/20 text-slate-900" : "bg-slate-50/50 text-slate-900")}>{formatValue(row.cy, activeTrend)}</td>
                          <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "bg-emerald-500/20 text-slate-800" : "bg-slate-50/50 text-slate-400")}>{formatValue(row.ly, activeTrend)}</td>
                          <td className={cn("px-4 py-4 text-center", isTotal ? "bg-emerald-500/20" : "bg-slate-50/50")}>
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-black border shadow-sm",
                              row.growth === 'N/A'
                                ? "text-slate-400 bg-slate-50 border-slate-200"
                                : Number(row.growth) >= 0
                                ? "text-emerald-600 bg-emerald-50 border-emerald-100"
                                : "text-rose-600 bg-rose-50 border-rose-100"
                            )}>
                              {row.growth === 'N/A' ? 'N/A' : `${Number(row.growth) >= 0 ? '+' : ''}${row.growth}%`}
                            </span>
                          </td>
                          <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.qtdCY, activeTrend)}</td>
                          <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.qtdLY, activeTrend)}</td>
                          <td className="px-4 py-4 text-center">
                            <span className={cn(
                              "text-[10px] font-black px-2 py-0.5 rounded-full border",
                              row.qtdGrowth === 'N/A'
                                ? "text-slate-400 bg-slate-50 border-slate-200"
                                : Number(row.qtdGrowth) >= 0
                                ? "text-emerald-600 bg-emerald-50 border-emerald-100"
                                : "text-rose-600 bg-rose-50 border-rose-100"
                            )}>
                              {row.qtdGrowth === 'N/A' ? 'N/A' : `${Number(row.qtdGrowth) >= 0 ? '+' : ''}${row.qtdGrowth}%`}
                            </span>
                          </td>
                          <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.ytdCY, activeTrend)}</td>
                          <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.ytdLY, activeTrend)}</td>
                          <td className="px-4 py-4 text-center">
                            <span className={cn(
                              "text-[10px] font-black px-2 py-0.5 rounded-full border",
                              row.ytdGrowth === 'N/A'
                                ? "text-slate-400 bg-slate-50 border-slate-200"
                                : Number(row.ytdGrowth) >= 0
                                ? "text-emerald-600 bg-emerald-50 border-emerald-100"
                                : "text-rose-600 bg-rose-50 border-rose-100"
                            )}>
                              {row.ytdGrowth === 'N/A' ? 'N/A' : `${Number(row.ytdGrowth) >= 0 ? '+' : ''}${row.ytdGrowth}%`}
                            </span>
                          </td>
                        </tr>

                        {isExpanded && row.subRows.map((sub: StatRow, subIdx: number) => (
                          <tr key={`${idx}-${subIdx}`} className="bg-slate-50/20 hover:bg-slate-50 transition-colors animate-in fade-in slide-in-from-top-1 duration-200">
                            <td className="px-16 py-3.5 text-[12px] font-bold text-slate-500">
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-[1px] bg-slate-200" />
                                {sub.name}
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.td, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-[12px] text-slate-700 text-center font-mono font-black border-l border-slate-100/50">{formatValue(sub.cy, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.ly, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-center">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                sub.growth === 'N/A'
                                  ? "text-slate-400 bg-white border-slate-200"
                                  : Number(sub.growth) >= 0 ? "text-emerald-500 bg-white border-emerald-100" : "text-rose-500 bg-white border-rose-100"
                              )}>
                                {sub.growth === 'N/A' ? 'N/A' : `${Number(sub.growth) >= 0 ? '+' : ''}${sub.growth}%`}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold border-l border-slate-100/50">{formatValue(sub.qtdCY, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.qtdLY, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-center">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                sub.qtdGrowth === 'N/A'
                                  ? "text-slate-400 bg-white border-slate-200"
                                  : Number(sub.qtdGrowth) >= 0 ? "text-emerald-500 bg-white border-emerald-100" : "text-rose-500 bg-white border-rose-100"
                              )}>
                                {sub.qtdGrowth === 'N/A' ? 'N/A' : `${Number(sub.qtdGrowth) >= 0 ? '+' : ''}${sub.qtdGrowth}%`}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold border-l border-slate-100/50">{formatValue(sub.ytdCY, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.ytdLY, activeTrend)}</td>
                            <td className="px-4 py-3.5 text-center">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                sub.ytdGrowth === 'N/A'
                                  ? "text-slate-400 bg-white border-slate-200"
                                  : Number(sub.ytdGrowth) >= 0 ? "text-emerald-500 bg-white border-emerald-100" : "text-rose-500 bg-white border-rose-100"
                              )}>
                                {sub.ytdGrowth === 'N/A' ? 'N/A' : `${Number(sub.ytdGrowth) >= 0 ? '+' : ''}${sub.ytdGrowth}%`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          ) : viewMode === 'trend' ? (
            <div className="p-8">
              <div className="flex items-center justify-end gap-6 mb-8 pr-10">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full border-2 border-teal-600 bg-white" />
                  <span className="text-[10px] font-bold text-slate-600">This Year</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full border-2 border-emerald-500 bg-white" />
                  <span className="text-[10px] font-bold text-slate-600">Last Year</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-0.5 w-6 bg-rose-400 border-t border-dashed border-rose-600" />
                  <span className="text-[10px] font-bold text-slate-600">Target</span>
                </div>
              </div>

              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9, fontWeight: 800, fill: '#64748b' }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                    />
                    <ReferenceLine y={dailyTarget} stroke="#f43f5e" strokeDasharray="5 5" label={{ position: 'right', value: 'Target', fill: '#f43f5e', fontSize: 10, fontWeight: 900 }} />
                    <Line
                      type="monotone"
                      dataKey="cy"
                      stroke="#055B65"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="ly"
                      stroke="#10b981"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-7 gap-3 mt-10">
                {kpiStats.map((kpi, kIdx) => (
                  <div key={kIdx} className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 text-center shadow-sm">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">{kpi.label}</p>
                    <p className={cn("text-lg font-black tracking-tight", kpi.color || "text-slate-800")}>{kpi.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === 'fy' ? (
            <div className="p-8">
              {/* Search Bar */}
              <div className="mb-6">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search metrics (Load, Labour, Parts, etc.)..."
                    value={fySearchQuery}
                    onChange={(e) => setFySearchQuery(e.target.value)}
                    className="w-full px-4 py-3 pl-11 text-sm font-medium text-slate-700 placeholder-slate-400 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                  />
                  <svg
                    className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-700 text-white">
                      <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest border-b border-white/10">Trends</th>
                      {fyTrendsData.map((fy) => (
                        <th key={fy.fy} className="px-6 py-4 text-center text-xs font-black uppercase tracking-widest border-b border-white/10">
                          {fy.fy}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                      <td className="px-6 py-4 text-sm font-bold text-slate-700">Load</td>
                      {fyTrendsData.map((fy) => (
                        <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                          {fy.load.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100 bg-blue-50/30">
                      <td className="px-6 py-4 text-sm font-bold text-slate-700">Labour</td>
                      {fyTrendsData.map((fy) => (
                        <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                          ₹{(fy.labour / 100000).toFixed(2)} L
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100 bg-purple-50/30">
                      <td className="px-6 py-4 text-sm font-bold text-slate-700">Part</td>
                      {fyTrendsData.map((fy) => (
                        <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                          ₹{(fy.parts / 100000).toFixed(2)} L
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                      <td className="px-6 py-4 text-sm font-bold text-slate-700">Labour Per RO</td>
                      {fyTrendsData.map((fy) => (
                        <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                          ₹{fy.labourPerRO.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                      <td className="px-6 py-4 text-sm font-bold text-slate-700">Parts Per RO</td>
                      {fyTrendsData.map((fy) => (
                        <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                          ₹{fy.partsPerRO.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : viewMode === 'analytics' ? (
            <div className="p-8 space-y-6">
              {/* KPI Cards Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {statsData.slice(0, 8).map((stat, idx) => (
                  <div key={idx} className="bg-gradient-to-br from-white to-slate-50 rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-lg transition-all duration-300">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">{stat.name}</h4>
                      <div className={cn(
                        "px-2 py-1 rounded-lg text-xs font-bold",
                        parseFloat(stat.growth) >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      )}>
                        {parseFloat(stat.growth) >= 0 ? '↑' : '↓'} {Math.abs(parseFloat(stat.growth))}%
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-slate-900">{stat.cy.toLocaleString()}</span>
                        <span className="text-sm font-bold text-slate-400">CY</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-slate-500">LY:</span>
                        <span className="font-mono font-bold text-slate-700">{stat.ly.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Row 1: Service Distribution & Performance Comparison */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Service Type Distribution - Enhanced Pie Chart */}
                <div className="bg-gradient-to-br from-white via-teal-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Service Distribution</h3>
                    <div className="px-3 py-1 bg-teal-100 text-teal-700 rounded-lg text-xs font-bold">Current Year</div>
                  </div>
                  <ResponsiveContainer width="100%" height={350}>
                    <PieChart>
                      <Pie
                        data={statsData.slice(0, 5).map(row => ({
                          name: row.name,
                          value: row.cy,
                        }))}
                        cx="50%"
                        cy="50%"
                        labelLine={true}
                        label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(1)}%`}
                        outerRadius={110}
                        innerRadius={60}
                        fill="#8884d8"
                        dataKey="value"
                        paddingAngle={2}
                      >
                        {statsData.slice(0, 5).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={
                            ['#0d9488', '#3b82f6', '#8b5cf6', '#f59e0b', '#64748b'][index % 5]
                          } />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        iconType="circle"
                        wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* CY vs LY Comparison - Enhanced Bar Chart */}
                <div className="bg-gradient-to-br from-white via-blue-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Year-over-Year Comparison</h3>
                    <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">CY vs LY</div>
                  </div>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={statsData.slice(0, 5)} barGap={8}>
                      <defs>
                        <linearGradient id="cyGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0d9488" stopOpacity={1}/>
                          <stop offset="100%" stopColor="#0d9488" stopOpacity={0.7}/>
                        </linearGradient>
                        <linearGradient id="lyGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#94a3b8" stopOpacity={1}/>
                          <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.7}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fontWeight: 'bold', fill: '#475569' }}
                        angle={-15}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                        iconType="circle"
                      />
                      <Bar dataKey="cy" fill="url(#cyGradient)" name="Current Year" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="ly" fill="url(#lyGradient)" name="Last Year" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Row 2: Growth Analysis & Trend Performance */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Growth Rate Analysis - Enhanced Bar Chart */}
                <div className="bg-gradient-to-br from-white via-emerald-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Growth Rate Analysis</h3>
                    <div className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">% Change</div>
                  </div>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={statsData.slice(0, 8).map(row => ({
                      name: row.name,
                      growth: parseFloat(row.growth)
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fontWeight: 'bold', fill: '#475569' }}
                        angle={-15}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        label={{ value: 'Growth %', angle: -90, position: 'insideLeft', style: { fontSize: 12, fontWeight: 'bold', fill: '#475569' } }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        formatter={(value: string | number | readonly (string | number)[] | undefined) => {
                          if (value === undefined || value === null) return 'N/A';
                          const numValue = typeof value === 'number' ? value : parseFloat(String(value));
                          return !isNaN(numValue) ? `${numValue.toFixed(1)}%` : 'N/A';
                        }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                      />
                      <ReferenceLine y={0} stroke="#64748b" strokeWidth={2} strokeDasharray="3 3" />
                      <Bar dataKey="growth" radius={[8, 8, 0, 0]}>
                        {statsData.slice(0, 8).map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={parseFloat(entry.growth) >= 0 ? '#10b981' : '#ef4444'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Service Performance Metrics - Stacked Bar */}
                <div className="bg-gradient-to-br from-white via-purple-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Performance Metrics</h3>
                    <div className="px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">Multi-Year</div>
                  </div>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={statsData.slice(0, 5)}>
                      <defs>
                        <linearGradient id="tdGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1}/>
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.7}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fontWeight: 'bold', fill: '#475569' }}
                        angle={-15}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                        iconType="circle"
                      />
                      <Bar dataKey="td" fill="url(#tdGradient)" name="Target Delivered" radius={[8, 8, 0, 0]} stackId="a" />
                      <Bar dataKey="cy" fill="#0d9488" name="Current Year" radius={[8, 8, 0, 0]} stackId="b" />
                      <Bar dataKey="ly" fill="#94a3b8" name="Last Year" radius={[8, 8, 0, 0]} stackId="b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Row 3: Financial Year Trends - Full Width */}
              <div className="bg-gradient-to-br from-white via-indigo-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Financial Year Performance Trends</h3>
                  <div className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold">Multi-Year Analysis</div>
                </div>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={fyTrendsData}>
                    <defs>
                      <linearGradient id="loadGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d9488" stopOpacity={0.8}/>
                        <stop offset="100%" stopColor="#0d9488" stopOpacity={0.1}/>
                      </linearGradient>
                      <linearGradient id="labourGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      </linearGradient>
                      <linearGradient id="partsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="fy"
                      tick={{ fontSize: 12, fontWeight: 'bold', fill: '#475569' }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '12px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '13px', fontWeight: 'bold' }}
                      iconType="line"
                    />
                    <Line
                      type="monotone"
                      dataKey="load"
                      stroke="#0d9488"
                      strokeWidth={4}
                      name="Load"
                      dot={{ r: 6, fill: '#0d9488', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 8 }}
                      fill="url(#loadGradient)"
                    />
                    <Line
                      type="monotone"
                      dataKey="labourPerRO"
                      stroke="#3b82f6"
                      strokeWidth={4}
                      name="Labour Per RO"
                      dot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 8 }}
                      fill="url(#labourGradient)"
                    />
                    <Line
                      type="monotone"
                      dataKey="partsPerRO"
                      stroke="#8b5cf6"
                      strokeWidth={4}
                      name="Parts Per RO"
                      dot={{ r: 6, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 8 }}
                      fill="url(#partsGradient)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Row 4: Quarterly Trends & YTD Growth */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Quarterly Performance */}
                <div className="bg-gradient-to-br from-white via-amber-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Quarterly Growth Trends</h3>
                    <div className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">QTD</div>
                  </div>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={statsData.slice(0, 5).map(row => ({
                      name: row.name,
                      qtd: parseFloat(row.qtdGrowth)
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fontWeight: 'bold', fill: '#475569' }}
                        angle={-15}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        label={{ value: 'QTD Growth %', angle: -90, position: 'insideLeft', style: { fontSize: 12, fontWeight: 'bold', fill: '#475569' } }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        formatter={(value: string | number | readonly (string | number)[] | undefined) => {
                          if (value === undefined || value === null) return 'N/A';
                          const numValue = typeof value === 'number' ? value : parseFloat(String(value));
                          return !isNaN(numValue) ? `${numValue.toFixed(1)}%` : 'N/A';
                        }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                      />
                      <ReferenceLine y={0} stroke="#64748b" strokeWidth={2} strokeDasharray="3 3" />
                      <Bar dataKey="qtd" radius={[8, 8, 0, 0]} name="QTD Growth">
                        {statsData.slice(0, 5).map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={parseFloat(entry.qtdGrowth) >= 0 ? '#f59e0b' : '#ef4444'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* YTD Performance */}
                <div className="bg-gradient-to-br from-white via-rose-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Year-to-Date Performance</h3>
                    <div className="px-3 py-1 bg-rose-100 text-rose-700 rounded-lg text-xs font-bold">YTD</div>
                  </div>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={statsData.slice(0, 5).map(row => ({
                      name: row.name,
                      ytd: parseFloat(row.ytdGrowth)
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fontWeight: 'bold', fill: '#475569' }}
                        angle={-15}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        label={{ value: 'YTD Growth %', angle: -90, position: 'insideLeft', style: { fontSize: 12, fontWeight: 'bold', fill: '#475569' } }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        formatter={(value: string | number | readonly (string | number)[] | undefined) => {
                          if (value === undefined || value === null) return 'N/A';
                          const numValue = typeof value === 'number' ? value : parseFloat(String(value));
                          return !isNaN(numValue) ? `${numValue.toFixed(1)}%` : 'N/A';
                        }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                      />
                      <ReferenceLine y={0} stroke="#64748b" strokeWidth={2} strokeDasharray="3 3" />
                      <Bar dataKey="ytd" radius={[8, 8, 0, 0]} name="YTD Growth">
                        {statsData.slice(0, 5).map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={parseFloat(entry.ytdGrowth) >= 0 ? '#ec4899' : '#ef4444'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Row 5: Comparative Analysis - Full Width */}
              <div className="bg-gradient-to-br from-white via-cyan-50/30 to-white rounded-2xl p-6 border border-slate-200 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">Comprehensive Service Type Analysis</h3>
                  <div className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-lg text-xs font-bold">All Metrics</div>
                </div>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={statsData.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fontWeight: 'bold', fill: '#475569' }}
                      angle={-15}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '12px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      iconType="line"
                    />
                    <Line
                      type="monotone"
                      dataKey="cy"
                      stroke="#0d9488"
                      strokeWidth={3}
                      name="Current Year"
                      dot={{ r: 5, fill: '#0d9488', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 7 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="ly"
                      stroke="#94a3b8"
                      strokeWidth={3}
                      name="Last Year"
                      dot={{ r: 5, fill: '#94a3b8', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 7 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="td"
                      stroke="#8b5cf6"
                      strokeWidth={3}
                      name="Target Delivered"
                      dot={{ r: 5, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 7 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : viewMode === 'revenue' ? (
            <div className="p-8">
              <ROBillingRevenueSection
                sheetId={sheetId}
                sheetName={sheetName}
                isAdmin={isAdmin}
                activeSheet={activeSheet}
                prefetchedData={prefetchedData}
                isPrefetching={isPrefetching}
                dateFilter={dateFilter}
              />
            </div>
          ) : null}
          </AccessControlOverlay>
        </CardContent>
      </Card>
    </>
  )
}
