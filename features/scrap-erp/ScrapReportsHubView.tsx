'use client'

import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { ScrapTransaction, normalizeScrapLocationName } from '@/lib/scrap-erp/types'
import { FileSpreadsheet, Printer, Download, MapPin, Building2, Layers, Users, ShieldCheck, Folder, Calendar, Tag } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

function getMonthYearLabel(dateStr: string) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return 'Unknown Month'
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
  } catch (e) {
    return 'Unknown Month'
  }
}

export function ScrapReportsHubView({ transactions }: { transactions: ScrapTransaction[] }) {
  const [reportType, setReportType] = useState<
    'location_summary' | 'location_month_summary' | 'group_summary' | 'scrap_type_summary' | 'dept_summary' | 'employee_summary' | 'outstanding_aging'
  >('location_summary')

  // 1. Location Summary Matrix
  const locationMatrix = useMemo(() => {
    const map: Record<string, { weight: number; revenue: number; received: number; due: number; count: number }> = {}
    transactions.forEach((t) => {
      const loc = normalizeScrapLocationName(t.locationName, t.groupName) || 'Unknown Location'
      if (!map[loc]) map[loc] = { weight: 0, revenue: 0, received: 0, due: 0, count: 0 }
      map[loc].weight += Number(t.weightQty || 0)
      map[loc].revenue += Number(t.calculatedTotal || 0)
      map[loc].received += Number(t.amountReceived || 0)
      map[loc].due += Number(t.outstandingAmount || 0)
      map[loc].count += 1
    })
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [transactions])

  // 2. Location Month Summary Matrix
  const locationMonthMatrix = useMemo(() => {
    const monthsSet = new Set<string>()
    const locMap: Record<string, Record<string, number> & { _totalRevenue: number; _totalWeight: number; _count: number }> = {}

    // First pass: collect all unique months & aggregate by location & month
    transactions.forEach((t) => {
      const dateVal = t.soldDate || t.timestamp.slice(0, 10)
      const monthLabel = getMonthYearLabel(dateVal)
      monthsSet.add(monthLabel)

      const loc = normalizeScrapLocationName(t.locationName, t.groupName) || 'Unknown Location'
      if (!locMap[loc]) {
        locMap[loc] = { _totalRevenue: 0, _totalWeight: 0, _count: 0 }
      }
      locMap[loc][monthLabel] = (locMap[loc][monthLabel] || 0) + Number(t.calculatedTotal || 0)
      locMap[loc]._totalRevenue += Number(t.calculatedTotal || 0)
      locMap[loc]._totalWeight += Number(t.weightQty || 0)
      locMap[loc]._count += 1
    })

    const months = Array.from(monthsSet).sort((a, b) => {
      const timeA = new Date(a).getTime()
      const timeB = new Date(b).getTime()
      return timeA - timeB
    })

    const rows = Object.entries(locMap)
      .map(([locationName, monthData]) => ({
        locationName,
        monthData,
        totalRevenue: monthData._totalRevenue,
        totalWeight: monthData._totalWeight,
        count: monthData._count,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)

    return { months, rows }
  }, [transactions])

  // 3. Group Summary Matrix
  const groupMatrix = useMemo(() => {
    const map: Record<string, { weight: number; revenue: number; received: number; due: number; count: number }> = {}
    transactions.forEach((t) => {
      const grp = t.groupName || 'JAM'
      if (!map[grp]) map[grp] = { weight: 0, revenue: 0, received: 0, due: 0, count: 0 }
      map[grp].weight += Number(t.weightQty || 0)
      map[grp].revenue += Number(t.calculatedTotal || 0)
      map[grp].received += Number(t.amountReceived || 0)
      map[grp].due += Number(t.outstandingAmount || 0)
      map[grp].count += 1
    })
    return Object.entries(map)
      .map(([name, data]) => ({
        name,
        ...data,
        efficiencyPct: data.revenue > 0 ? Math.round((data.received / data.revenue) * 100) : 100,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [transactions])

  // 4. Scrap Type Summary Matrix
  const scrapTypeMatrix = useMemo(() => {
    const map: Record<string, { unit: string; weight: number; revenue: number; received: number; due: number; count: number }> = {}
    transactions.forEach((t) => {
      const type = t.scrapTypeName || 'Other'
      if (!map[type]) map[type] = { unit: t.unit || 'Kg', weight: 0, revenue: 0, received: 0, due: 0, count: 0 }
      map[type].weight += Number(t.weightQty || 0)
      map[type].revenue += Number(t.calculatedTotal || 0)
      map[type].received += Number(t.amountReceived || 0)
      map[type].due += Number(t.outstandingAmount || 0)
      map[type].count += 1
    })
    return Object.entries(map)
      .map(([name, data]) => ({
        name,
        ...data,
        avgRate: data.weight > 0 ? data.revenue / data.weight : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [transactions])

  // Monthwise Average Rate (₹ / Unit) Matrix by Scrap Type & Month Computation
  const scrapTypeRateAnalytics = useMemo(() => {
    const monthOrder = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    const monthSet = new Set<string>()

    const typeUnitMap: Record<
      string,
      {
        scrapTypeName: string
        unit: string
        totalAmount: number
        totalWeight: number
        ratedAmount?: number
        // ratedAmount = the slice of `amount` that has weight behind it, used as the rate numerator.
        monthData: Record<string, { amount: number; weight: number; count: number; ratedAmount: number }>
      }
    > = {}

    transactions.forEach((t) => {
      const typeName = (t.scrapTypeName || 'OTHER').toUpperCase().trim()
      const unit = (t.unit || 'Kg').trim()
      const key = `${typeName}___${unit}`

      const d = t.soldDate || t.timestamp || t.createdAt
      if (!d) return
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return

      const monthShort = dt.toLocaleString('en-IN', { month: 'short' })
      monthSet.add(monthShort)

      const amt = Number(t.amountReceived || t.calculatedTotal || 0)
      const wt = Number(t.weightQty || 0)

      if (!typeUnitMap[key]) {
        typeUnitMap[key] = {
          scrapTypeName: typeName,
          unit,
          totalAmount: 0,
          totalWeight: 0,
          monthData: {},
        }
      }

      typeUnitMap[key].totalAmount += amt
      typeUnitMap[key].totalWeight += wt

      if (!typeUnitMap[key].monthData[monthShort]) {
        typeUnitMap[key].monthData[monthShort] = { amount: 0, weight: 0, count: 0, ratedAmount: 0 }
      }

      typeUnitMap[key].monthData[monthShort].amount += amt
      typeUnitMap[key].monthData[monthShort].weight += wt
      typeUnitMap[key].monthData[monthShort].count += 1
      // An average RATE must divide value by the weight that value was actually earned on. Rows
      // sold at a stated total (no weight recorded) contribute money to the numerator and nothing
      // to the denominator, which inflates the rate — July SCRAP read Rs 25.34/Kg against a true
      // Rs 19.16/Kg (+32.3%). `ratedAmount` tracks only the value that has weight behind it, so
      // the rate is honest; `amount` stays the full revenue for the value columns.
      if (wt > 0) {
        typeUnitMap[key].monthData[monthShort].ratedAmount += amt
        typeUnitMap[key].ratedAmount = (typeUnitMap[key].ratedAmount || 0) + amt
      }
    })

    const availableMonths = Array.from(monthSet).sort(
      (a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b)
    )
    const monthColumns = availableMonths.length > 0 ? availableMonths : ['Apr', 'May', 'Jun', 'Jul']

    const rows = Object.values(typeUnitMap)
      .map((item) => {
        const overallAvgRate = item.totalWeight > 0 ? (item.ratedAmount || 0) / item.totalWeight : 0

        const monthAvgRates: Record<
          string,
          { avgRate: number; totalAmount: number; totalWeight: number; count: number }
        > = {}

        monthColumns.forEach((m) => {
          const mData = item.monthData[m] || { amount: 0, weight: 0, count: 0, ratedAmount: 0 }
          const avgRate = mData.weight > 0 ? (mData.ratedAmount || 0) / mData.weight : 0
          monthAvgRates[m] = {
            avgRate,
            totalAmount: mData.amount,
            totalWeight: mData.weight,
            count: mData.count,
          }
        })

        return {
          scrapTypeName: item.scrapTypeName,
          unit: item.unit,
          totalAmount: item.totalAmount,
          totalWeight: item.totalWeight,
          overallAvgRate,
          monthAvgRates,
        }
      })
      .sort((a, b) => b.totalAmount - a.totalAmount)

    return {
      monthColumns,
      rows,
    }
  }, [transactions])

  // 5. Department Summary Matrix
  const deptMatrix = useMemo(() => {
    const map: Record<string, { weight: number; revenue: number; received: number; due: number; count: number }> = {}
    transactions.forEach((t) => {
      const dept = t.departmentName || 'SERVICE'
      if (!map[dept]) map[dept] = { weight: 0, revenue: 0, received: 0, due: 0, count: 0 }
      map[dept].weight += Number(t.weightQty || 0)
      map[dept].revenue += Number(t.calculatedTotal || 0)
      map[dept].received += Number(t.amountReceived || 0)
      map[dept].due += Number(t.outstandingAmount || 0)
      map[dept].count += 1
    })
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [transactions])

  // 6. Sold By Summary Matrix
  const employeeMatrix = useMemo(() => {
    const map: Record<string, { revenue: number; received: number; count: number }> = {}
    transactions.forEach((t) => {
      const emp = t.soldByName || 'SHIKHA'
      if (!map[emp]) map[emp] = { revenue: 0, received: 0, count: 0 }
      map[emp].revenue += Number(t.calculatedTotal || 0)
      map[emp].received += Number(t.amountReceived || 0)
      map[emp].count += 1
    })
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [transactions])

  // 7. Outstanding Aging Matrix
  const outstandingRows = useMemo(() => {
    return transactions.filter((t) => Math.round(Number(t.outstandingAmount || 0)) >= 1)
  }, [transactions])

  // EXPORT TO EXCEL HANDLERS FOR EACH SUMMARY TABLE
  const exportToExcel = (data: any[], filename: string, sheetName = 'Summary') => {
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    XLSX.writeFile(workbook, `${filename}.xlsx`)
  }

  const handleExportCurrentReportToExcel = () => {
    if (reportType === 'location_summary') {
      const excelData = locationMatrix.map((r) => ({
        'Location Name': r.name,
        'Disposal Count': r.count,
        'Total Weight (Kg/Ltr)': r.weight,
        'Total Revenue (₹)': r.revenue,
        'Amount Received (₹)': r.received,
        'Outstanding Due (₹)': r.due,
      }))
      exportToExcel(excelData, 'Scrap_Location_Summary', 'Location Summary')
    } else if (reportType === 'location_month_summary') {
      const excelData = locationMonthMatrix.rows.map((r) => {
        const rowObj: Record<string, any> = {
          'Dealership Location': r.locationName,
          'Total Disposals': r.count,
          'Total Weight (Kg/Ltr)': r.totalWeight,
        }
        locationMonthMatrix.months.forEach((m) => {
          rowObj[`Revenue - ${m} (₹)`] = r.monthData[m] || 0
        })
        rowObj['Total Revenue (₹)'] = r.totalRevenue
        return rowObj
      })
      exportToExcel(excelData, 'Scrap_Location_Month_Summary', 'Location Month Summary')
    } else if (reportType === 'group_summary') {
      const excelData = groupMatrix.map((r) => ({
        'Dealership Group': r.name,
        'Disposal Count': r.count,
        'Total Weight (Kg/Ltr)': r.weight,
        'Total Revenue (₹)': r.revenue,
        'Amount Received (₹)': r.received,
        'Outstanding Due (₹)': r.due,
        'Collection Efficiency %': `${r.efficiencyPct}%`,
      }))
      exportToExcel(excelData, 'Scrap_Group_Summary', 'Group Summary')
    } else if (reportType === 'scrap_type_summary') {
      const excelData = scrapTypeMatrix.map((r) => ({
        'Scrap Category': r.name,
        Unit: r.unit,
        'Disposal Count': r.count,
        'Total Weight Disposed': r.weight,
        'Average Rate / Unit (₹)': Number(r.avgRate.toFixed(2)),
        'Total Revenue (₹)': r.revenue,
        'Amount Received (₹)': r.received,
        'Outstanding Due (₹)': r.due,
      }))
      exportToExcel(excelData, 'Scrap_Category_Summary', 'Scrap Type Summary')
    } else if (reportType === 'dept_summary') {
      const excelData = deptMatrix.map((r) => ({
        Department: r.name,
        'Disposal Count': r.count,
        'Total Weight (Kg/Ltr)': r.weight,
        'Total Revenue (₹)': r.revenue,
        'Amount Received (₹)': r.received,
        'Outstanding Due (₹)': r.due,
      }))
      exportToExcel(excelData, 'Scrap_Department_Summary', 'Department Summary')
    } else if (reportType === 'employee_summary') {
      const excelData = employeeMatrix.map((r) => ({
        'Employee Name (Sold By)': r.name,
        'Disposal Count': r.count,
        'Total Revenue Processed (₹)': r.revenue,
        'Amount Received (₹)': r.received,
      }))
      exportToExcel(excelData, 'Scrap_Sold_By_Summary', 'Sold By Summary')
    } else if (reportType === 'outstanding_aging') {
      const excelData = outstandingRows.map((r) => ({
        'Transaction #': r.transactionNumber,
        'Sold Date': r.soldDate || r.timestamp.slice(0, 10),
        Group: r.groupName || 'JAM',
        Location: r.locationName,
        Department: r.departmentName,
        'Scrap Type': r.scrapTypeName,
        'Buyer / Vendor': r.soldTo,
        'Total Revenue (₹)': r.calculatedTotal,
        'Amount Received (₹)': r.amountReceived,
        'Outstanding Due (₹)': r.outstandingAmount,
      }))
      exportToExcel(excelData, 'Scrap_Outstanding_Audit', 'Outstanding Audit')
    }
  }

  const handlePrintReport = () => {
    window.print()
  }

  return (
    <Card className="space-y-6 p-6">
      {/* Header & Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <CardTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> Executive Scrap Summary Hub
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
            Location, Month, Group, Scrap Type & Department Summary Matrices
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* EXPORT TO EXCEL BUTTON FOR CURRENT SUMMARY TABLE */}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleExportCurrentReportToExcel}
            style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
            className="rounded-xl text-xs font-black shadow-md border-0"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export to Excel (.xlsx)
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={handlePrintReport} className="rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700">
            <Printer className="h-3.5 w-3.5 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* Report Selector Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-100 dark:border-slate-800">
        {[
          { key: 'location_summary', label: 'Location Summary', icon: MapPin, count: locationMatrix.length },
          { key: 'location_month_summary', label: 'Location Month Summary', icon: Calendar, count: locationMonthMatrix.rows.length },
          { key: 'group_summary', label: 'Group Summary', icon: Folder, count: groupMatrix.length },
          { key: 'scrap_type_summary', label: 'Scrap Type Summary', icon: Layers, count: scrapTypeMatrix.length },
          { key: 'dept_summary', label: 'Department Summary', icon: Building2, count: deptMatrix.length },
          { key: 'employee_summary', label: 'Sold By Summary', icon: Users, count: employeeMatrix.length },
          { key: 'outstanding_aging', label: 'Outstanding Audit', icon: ShieldCheck, count: outstandingRows.length },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = reportType === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setReportType(tab.key as any)}
              style={isActive ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)', borderColor: 'var(--dashboard-action-bg)' } : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all whitespace-nowrap border',
                isActive
                  ? 'shadow-md font-black'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-black',
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Summary Table Header Bar with Dedicated Excel Export Action */}
      <div className="flex items-center justify-between text-xs font-black text-slate-900 dark:text-slate-100 bg-slate-100/80 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
        <span className="uppercase tracking-wider">
          Active Summary: {reportType.replace(/_/g, ' ')}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportCurrentReportToExcel}
          className="rounded-xl text-xs font-bold h-7 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <Download className="h-3 w-3 mr-1" /> Download {reportType.replace(/_/g, ' ')} (.xlsx)
        </Button>
      </div>

      {/* Matrix Tables */}
      <div className="overflow-x-auto">
        {/* 1. LOCATION SUMMARY TABLE */}
        {reportType === 'location_summary' && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-xs font-extrabold">Dealership Location</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Transactions</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Weight (Kg/Ltr)</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Revenue</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Amount Received</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Outstanding Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locationMatrix.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-extrabold text-xs text-foreground">{row.name}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.count}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.weight.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-xs text-right font-black text-foreground">{formatINR(row.revenue)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{formatINR(row.received)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-rose-600">{row.due > 0 ? formatINR(row.due) : '₹0'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 2. LOCATION MONTH SUMMARY TABLE */}
        {reportType === 'location_month_summary' && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-xs font-extrabold">Dealership Location</TableHead>
                {locationMonthMatrix.months.map((m) => (
                  <TableHead key={m} className="text-xs font-extrabold text-right">
                    {m}
                  </TableHead>
                ))}
                <TableHead className="text-xs font-extrabold text-right">Total Revenue</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Weight (Kg/Ltr)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locationMonthMatrix.rows.map((row) => (
                <TableRow key={row.locationName}>
                  <TableCell className="font-extrabold text-xs text-foreground whitespace-nowrap">
                    {row.locationName}
                  </TableCell>
                  {locationMonthMatrix.months.map((m) => {
                    const val = row.monthData[m] || 0
                    return (
                      <TableCell key={m} className="text-xs text-right font-semibold text-muted-foreground whitespace-nowrap">
                        {val > 0 ? formatINR(val) : '—'}
                      </TableCell>
                    )
                  })}
                  <TableCell className="text-xs text-right font-black text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                    {formatINR(row.totalRevenue)}
                  </TableCell>
                  <TableCell className="text-xs text-right font-bold text-foreground whitespace-nowrap">
                    {row.totalWeight.toLocaleString('en-IN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 3. GROUP SUMMARY TABLE */}
        {reportType === 'group_summary' && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-xs font-extrabold">Dealership Group</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Transactions</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Weight (Kg/Ltr)</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Revenue</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Amount Received</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Outstanding Due</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Efficiency %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupMatrix.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-extrabold text-xs text-foreground flex items-center gap-1.5">
                    <Badge variant="outline" className="font-bold text-xs">
                      {row.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.count}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.weight.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-xs text-right font-black text-foreground">{formatINR(row.revenue)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{formatINR(row.received)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-rose-600">{row.due > 0 ? formatINR(row.due) : '₹0'}</TableCell>
                  <TableCell className="text-xs text-right font-black text-indigo-600">{row.efficiencyPct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 4. SCRAP TYPE SUMMARY TABLE & MONTHWISE AVERAGE RATE MATRIX */}
        {reportType === 'scrap_type_summary' && (
          <div className="space-y-6">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-xs font-extrabold">Scrap Category</TableHead>
                  <TableHead className="text-xs font-extrabold">Unit</TableHead>
                  <TableHead className="text-xs font-extrabold text-right">Transactions</TableHead>
                  <TableHead className="text-xs font-extrabold text-right">Total Weight Disposed</TableHead>
                  <TableHead className="text-xs font-extrabold text-right">Avg Rate / Unit</TableHead>
                  <TableHead className="text-xs font-extrabold text-right">Total Revenue</TableHead>
                  <TableHead className="text-xs font-extrabold text-right">Received</TableHead>
                  <TableHead className="text-xs font-extrabold text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scrapTypeMatrix.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-extrabold text-xs text-foreground">{row.name}</TableCell>
                    <TableCell className="text-xs font-bold text-muted-foreground">{row.unit}</TableCell>
                    <TableCell className="text-xs text-right font-bold">{row.count}</TableCell>
                    <TableCell className="text-xs text-right font-bold">{row.weight.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-xs text-right font-bold text-indigo-600 dark:text-indigo-400">₹{row.avgRate.toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-right font-black text-foreground">{formatINR(row.revenue)}</TableCell>
                    <TableCell className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{formatINR(row.received)}</TableCell>
                    <TableCell className="text-xs text-right font-bold text-rose-600">{row.due > 0 ? formatINR(row.due) : '₹0'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* MONTH-BY-MONTH AVERAGE RATE (₹ / UNIT) MATRIX TABLE */}
            <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden border-l-4 border-l-emerald-600">
              <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800 bg-emerald-50/30 dark:bg-emerald-950/20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-emerald-100 dark:bg-emerald-900/60 p-2.5 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <Tag className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        Month-by-Month Average Selling Rate (₹ / Unit) by Scrap Type & Unit
                      </CardTitle>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                        Historical average selling price trends per unit across months (e.g. CARDBOARD: ₹15.00/Kg in Apr vs ₹16.20/Kg in May).
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 text-xs font-black self-start md:self-auto">
                    {scrapTypeRateAnalytics.rows.length} Categories Tracked
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {scrapTypeRateAnalytics.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-900 text-white dark:bg-slate-800 border-b border-slate-800 dark:border-slate-700">
                        <tr>
                          <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider text-slate-100 border-r border-slate-800 dark:border-slate-700">
                            SCRAP TYPE & UNIT
                          </th>
                          {scrapTypeRateAnalytics.monthColumns.map((m) => (
                            <th key={m} className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-slate-100">
                              {m.toUpperCase()} AVG RATE
                            </th>
                          ))}
                          <th className="py-3 px-4 text-center font-black uppercase text-[10px] tracking-wider text-emerald-400 bg-slate-800/80">
                            OVERALL AVG RATE
                          </th>
                          <th className="py-3 px-4 text-right font-black uppercase text-[10px] tracking-wider text-slate-100">
                            TOTAL QTY
                          </th>
                          <th className="py-3 px-4 text-right font-black uppercase text-[10px] tracking-wider text-amber-400">
                            TOTAL REVENUE
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 font-medium">
                        {scrapTypeRateAnalytics.rows.map((row) => (
                          <tr key={`${row.scrapTypeName}-${row.unit}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4 font-black text-slate-900 dark:text-slate-100 border-r border-slate-100 dark:border-slate-800">
                              <div className="flex items-center gap-2">
                                <span className="font-black text-slate-900 dark:text-slate-100 text-xs">
                                  {row.scrapTypeName}
                                </span>
                                <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 text-[10px] font-black border border-slate-200 dark:border-slate-700">
                                  /{row.unit}
                                </span>
                              </div>
                            </td>
                            {scrapTypeRateAnalytics.monthColumns.map((m) => {
                              const mInfo = row.monthAvgRates[m]
                              return (
                                <td key={m} className="py-3 px-3 text-center">
                                  {mInfo.count > 0 ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="inline-flex items-center rounded-md bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 px-2 py-0.5 text-xs font-black shadow-2xs">
                                        ₹{mInfo.avgRate.toFixed(2)}
                                      </span>
                                      <span className="text-[9px] text-slate-400 font-bold">
                                        {mInfo.totalWeight.toLocaleString('en-IN')} {row.unit}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600 font-bold">-</span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="py-3 px-4 text-center font-black text-emerald-700 dark:text-emerald-400 bg-emerald-50/20 dark:bg-emerald-950/20">
                              <span className="inline-flex items-center rounded-md bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 px-2.5 py-1 text-xs font-black shadow-2xs">
                                ₹{row.overallAvgRate.toFixed(2)} /{row.unit}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-black text-slate-800 dark:text-slate-200">
                              {row.totalWeight.toLocaleString('en-IN')} {row.unit}
                            </td>
                            <td className="py-3 px-4 text-right font-black text-amber-700 dark:text-amber-400">
                              {formatINR(row.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400 text-xs font-medium">
                    No scrap type rate data available.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* 5. DEPARTMENT SUMMARY TABLE */}
        {reportType === 'dept_summary' && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-xs font-extrabold">Department</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Transactions</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Weight (Kg/Ltr)</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Revenue</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Amount Received</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deptMatrix.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-extrabold text-xs text-foreground">{row.name}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.count}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.weight.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-xs text-right font-black text-foreground">{formatINR(row.revenue)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{formatINR(row.received)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-rose-600">{row.due > 0 ? formatINR(row.due) : '₹0'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 6. SOLD BY SUMMARY TABLE */}
        {reportType === 'employee_summary' && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-xs font-extrabold">Employee Name (Sold By)</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Disposal Transactions</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Revenue Processed</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Amount Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employeeMatrix.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-extrabold text-xs text-foreground">{row.name}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{row.count}</TableCell>
                  <TableCell className="text-xs text-right font-black text-foreground">{formatINR(row.revenue)}</TableCell>
                  <TableCell className="text-xs text-right font-bold text-emerald-600 dark:text-emerald-400">{formatINR(row.received)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 7. OUTSTANDING AGING TABLE */}
        {reportType === 'outstanding_aging' && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-xs font-extrabold">Txn #</TableHead>
                <TableHead className="text-xs font-extrabold">Location</TableHead>
                <TableHead className="text-xs font-extrabold">Group</TableHead>
                <TableHead className="text-xs font-extrabold">Buyer / Vendor</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Revenue</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Received</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Outstanding Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outstandingRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-xs text-muted-foreground font-bold">
                    ✓ All transactions settled cleanly. Zero outstanding balance!
                  </TableCell>
                </TableRow>
              ) : (
                outstandingRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-extrabold text-xs text-indigo-600">{row.transactionNumber}</TableCell>
                    <TableCell className="text-xs font-bold">{row.locationName}</TableCell>
                    <TableCell className="text-xs font-semibold">{row.groupName || 'JAM'}</TableCell>
                    <TableCell className="text-xs font-semibold">{row.soldTo}</TableCell>
                    <TableCell className="text-xs font-extrabold text-right">{formatINR(row.calculatedTotal)}</TableCell>
                    <TableCell className="text-xs font-bold text-right text-emerald-600">{formatINR(row.amountReceived)}</TableCell>
                    <TableCell className="text-xs font-black text-right text-rose-600">{formatINR(row.outstandingAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </Card>
  )
}
