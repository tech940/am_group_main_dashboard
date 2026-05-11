'use client'

import React, { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, FileSpreadsheet, Download, Table as TableIcon, Eye, RefreshCw, Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight, Pin, PinOff } from 'lucide-react'

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
  const [loading, setLoading] = useState(false)
  const [fetchingRows, setFetchingRows] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'view' | 'upload'>('view')
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([])
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

  const fetchSavedMetadata = useCallback(async () => {
    try {
      setLoading(true) // Now part of the async execution flow
      const response = await fetch('/api/brands/kia/business-excellence?brand=kia')
      if (response.ok) {
        const data = await response.json()
        setSavedSheets(data)
        if (data.length > 0) {
          setViewMode('view')
          const firstSheet = data[0]
          setActiveTab(firstSheet.sheetName)
          fetchSheetRows(firstSheet.id)
        }
      }
    } catch (error) {
      console.error('Failed to fetch saved metadata:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchSheetRows])

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
    <MainLayout hideHeader>
      <div className="space-y-4 max-w-[1600px] mx-auto animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Kia Business Excellence</h1>
            <p className="text-[10px] text-slate-500 mt-1 font-bold uppercase tracking-widest">Operational performance monitoring</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (viewMode === 'upload') {
                  setViewMode('view')
                  setSheets([])
                  setFileName(null)
                  if (savedSheets.length > 0) setActiveTab(savedSheets[0].sheetName)
                } else {
                  fetchSavedMetadata()
                }
              }}
              className="rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm font-bold h-10 px-4"
            >
              {viewMode === 'upload' ? (
                <><Eye className="mr-2 h-3.5 w-3.5" /> Cancel</>
              ) : (
                <><RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh</>
              )}
            </Button>

            <label className="relative">
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <Button size="sm" className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-100 font-bold h-10 px-4">
                <Upload className="mr-2 h-3.5 w-3.5" /> {viewMode === 'upload' ? 'Change' : 'Update'}
              </Button>
            </label>

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

        {activeSheets.length > 0 && activeTab && (
          <div className="space-y-4">
            {activeSheets.filter(s => s.name === activeTab).map((sheet) => {
              const totalRecords = viewMode === 'upload' ? sheet.data.length : sheet.totalRows || 0
              const totalPages = Math.ceil(totalRecords / itemsPerPage)
              const startIndex = (currentPage - 1) * itemsPerPage
              const tableData = viewMode === 'upload' ? sheet.data.slice(startIndex, startIndex + itemsPerPage) : sheet.data

              return (
                <div key={sheet.name} className="animate-in slide-in-from-bottom-4 duration-500">
                  <Card className="rounded-[1.5rem] border-none bg-white shadow-xl shadow-slate-200/50 overflow-hidden">
                    <CardHeader className="border-b border-slate-50 bg-slate-50/30 p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100/50">
                            <TableIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-xl font-semibold text-slate-800 tracking-tight">{sheet.name}</CardTitle>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                {viewMode === 'view' && !loadedRows[sheet.id] ? 'Loading...' : `${totalRecords.toLocaleString()} Records`}
                              </span>
                              <span className="w-1 h-1 rounded-full bg-slate-200" />
                              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                {sheet.columns.length} Columns
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 pr-3 border-r border-slate-100">
                            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Sheet:</p>
                            <Select value={activeTab} onValueChange={handleTabChange}>
                              <SelectTrigger className="w-[220px] h-9 rounded-xl border-slate-200 font-bold text-slate-700 text-xs">
                                <SelectValue placeholder="Choose a sheet" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-100 bg-white shadow-2xl z-[100]">
                                {activeSheets.map((sheet) => (
                                  <SelectItem key={sheet.name} value={sheet.name} className="font-bold rounded-lg m-1 text-xs">
                                    {sheet.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {viewMode === 'view' && (
                            <Button variant="ghost" size="sm" className="h-9 rounded-xl hover:bg-slate-100 text-slate-400 font-bold uppercase tracking-widest text-[9px] px-4">
                              <Download className="h-3.5 w-3.5 mr-2" /> Export
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {fetchingRows === sheet.id ? (
                        <div className="flex flex-col items-center justify-center py-40 gap-4">
                          <Loader2 className="h-10 w-10 text-purple-500 animate-spin" />
                          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Optimizing Data Stream...</p>
                        </div>
                      ) : (
                        <>
                          {/* Pagination Controls */}
                          {totalRecords > 0 && (
                            <div className="p-4 bg-slate-50/30 flex items-center justify-between border-b border-slate-50">
                              <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalRecords)} of {totalRecords.toLocaleString()} records
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={currentPage === 1}
                                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                  className="rounded-lg h-8 w-8 p-0 border-slate-200 text-slate-500 hover:text-purple-600 hover:border-purple-200"
                                >
                                  <ChevronLeft className="h-3 w-3" />
                                </Button>
                                <div className="flex items-center gap-1">
                                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let pageNum = i + 1;
                                    if (totalPages > 5 && currentPage > 3) {
                                      pageNum = currentPage - 3 + i + 1;
                                      if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                                    }

                                    return (
                                      <Button
                                        key={pageNum}
                                        variant={currentPage === pageNum ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={cn(
                                          "rounded-lg h-8 w-8 p-0 font-bold transition-all text-[10px]",
                                          currentPage === pageNum
                                            ? "bg-purple-600 text-white shadow-lg shadow-purple-100 border-none"
                                            : "border-slate-200 text-slate-500"
                                        )}
                                      >
                                        {pageNum}
                                      </Button>
                                    )
                                  })}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={currentPage === totalPages}
                                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                  className="rounded-lg h-8 w-8 p-0 border-slate-200 text-slate-500 hover:text-purple-600 hover:border-purple-200"
                                >
                                  <ChevronRight className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-slate-50/80">
                                  {sheet.columns.map((col: string, index: number) => {
                                    const isPinned = pinnedColumns.includes(col)
                                    // Estimate offset (approx 150px per pinned column for simplicity, 
                                    // or just stack them if few. For real robustness we'd need refs)
                                    const pinnedIndex = pinnedColumns.indexOf(col)
                                    const leftOffset = pinnedIndex * 150

                                    return (
                                      <th
                                        key={`${col}-${index}`}
                                        style={isPinned ? { left: leftOffset, zIndex: 40 } : {}}
                                        className={cn(
                                          "px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 border-b border-slate-100 whitespace-nowrap transition-all",
                                          isPinned && "sticky bg-slate-100/95 backdrop-blur-md shadow-[2px_0_5px_rgba(0,0,0,0.05)] border-r border-slate-200"
                                        )}
                                      >
                                        <div className="flex items-center justify-between gap-3 group/head">
                                          <span>{col}</span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setPinnedColumns(prev => 
                                                prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
                                              )
                                            }}
                                            className={cn(
                                              "p-1 rounded-md transition-all",
                                              isPinned ? "text-purple-600 bg-purple-50 opacity-100" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                                            )}
                                          >
                                            {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                                          </button>
                                        </div>
                                      </th>
                                    )
                                  })}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {tableData.map((row: Record<string, unknown>, rowIndex: number) => (
                                  <tr
                                    key={rowIndex}
                                    className="hover:bg-slate-50/50 transition-colors group"
                                  >
                                    {sheet.columns.map((col: string, colIndex: number) => {
                                      const isPinned = pinnedColumns.includes(col)
                                      const pinnedIndex = pinnedColumns.indexOf(col)
                                      const leftOffset = pinnedIndex * 150

                                      return (
                                        <td 
                                          key={`${col}-${colIndex}`}
                                          style={isPinned ? { left: leftOffset, zIndex: 30 } : {}}
                                          className={cn(
                                            "px-6 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap border-r border-slate-50 last:border-r-0 transition-all",
                                            isPinned && "sticky bg-white/95 backdrop-blur-md shadow-[2px_0_5px_rgba(0,0,0,0.05)] border-r border-slate-200"
                                          )}
                                        >
                                          {row[col] === undefined || row[col] === null ? (
                                            <span className="text-slate-200">—</span>
                                          ) : typeof row[col] === 'number' ? (
                                            row[col].toLocaleString()
                                          ) : row[col] instanceof Date ? (
                                            (row[col] as Date).toLocaleDateString('en-GB')
                                          ) : (
                                            row[col].toString()
                                          )}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {sheet.data.length === 0 && viewMode === 'view' && !fetchingRows && (
                              <div className="py-20 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">
                                No rows found in this sheet
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </MainLayout>
  )
}
