'use client'

import { useState } from 'react'
import {
  Search,
  Download,
  Eye,
  ArrowUpDown,
  Car,
  Shield,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Copy,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TablePager, type InsurancePageSize } from '@/features/insurance/table-pager'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'

type Props = {
  brand: InsuranceBrandId
  policiesData: {
    policies?: any[]
    rows?: any[]
    totalCount?: number
    total?: number
    totalPages?: number
  }
  isLoading: boolean
  searchQuery: string
  onSearchChange: (q: string) => void
  page: number
  onPageChange: (p: number) => void
  pageSize: InsurancePageSize
  onPageSizeChange: (size: InsurancePageSize) => void
  sort: string
  sortDir: 'asc' | 'desc'
  onSortChange: (sort: string) => void
  onInspectPolicy: (policy: any) => void
  onExportCsv: () => void
  isExporting: boolean
}

function formatInr(val?: number | null) {
  const n = Number(val || 0)
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(val?: string | null) {
  if (!val) return '—'
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function RegisterWorkspace({
  brand,
  policiesData,
  isLoading,
  searchQuery,
  onSearchChange,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  sort,
  sortDir,
  onSortChange,
  onInspectPolicy,
  onExportCsv,
  isExporting,
}: Props) {
  const brandConfig = INSURANCE_BRANDS[brand]
  const cap = brandConfig.capabilities

  const rows = policiesData?.policies || policiesData?.rows || []
  const totalCount = policiesData?.totalCount ?? policiesData?.total ?? rows.length
  const totalPages = policiesData?.totalPages ?? Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <div className="space-y-4">
      {/* Search & Export Action Toolbar */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by VIN, Customer, Policy #..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 pl-9 rounded-xl text-xs font-medium"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            disabled={isExporting || rows.length === 0}
            className="h-9 rounded-xl text-xs font-bold gap-1.5 border-slate-200 dark:border-slate-700 shadow-2xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-teal-600" />
            <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
          </Button>
        </div>
      </div>

      {/* Main Register Table */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="w-12 text-[10px] font-bold uppercase tracking-wider">#</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Customer & Policy</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Vehicle & Chassis (VIN)</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Insurer Partner</TableHead>
              <TableHead
                className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:text-teal-600"
                onClick={() => onSortChange('policy_issue_date')}
              >
                <div className="flex items-center gap-1">
                  <span>Issue Date</span>
                  <ArrowUpDown className="h-3 w-3 text-slate-400" />
                </div>
              </TableHead>
              <TableHead
                className="text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:text-teal-600"
                onClick={() => onSortChange('gross_premium')}
              >
                <div className="flex items-center gap-1">
                  <span>Gross Premium</span>
                  <ArrowUpDown className="h-3 w-3 text-slate-400" />
                </div>
              </TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider pr-4">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-xs text-slate-400">
                  Loading policy register records...
                </TableCell>
              </TableRow>
            ) : rows.length > 0 ? (
              rows.map((p, idx) => {
                const rowNum = (page - 1) * pageSize + idx + 1
                return (
                  <TableRow
                    key={p.id || p.policyNo || idx}
                    onClick={() => onInspectPolicy(p)}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                  >
                    <TableCell className="font-mono text-xs text-slate-400 font-medium">
                      {rowNum}
                    </TableCell>

                    <TableCell>
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-teal-600">
                        {p.customerName || p.customer_name || 'Customer'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {p.policyNo || p.policy_no || '—'}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                        {p.modelName || p.model_name || 'Vehicle'} {p.variantName ? `• ${p.variantName}` : ''}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {p.chassisNo || p.chassis_no || '—'}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {p.insuranceCompany || p.insurance_company || '—'}
                    </TableCell>

                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {formatDate(p.policyIssueDate || p.policy_issue_date)}
                    </TableCell>

                    <TableCell>
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {formatInr(p.grossPremium || p.gross_premium)}
                      </span>
                    </TableCell>

                    <TableCell className="text-right pr-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px] font-bold text-teal-600 hover:text-teal-700 hover:bg-teal-50 gap-1 rounded-lg"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Inspect</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-xs text-slate-400">
                  No policy records matching this search query
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pager */}
        {totalCount > 0 && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800">
            <TablePager
              page={page}
              totalPages={totalPages}
              totalRows={totalCount}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              noun="policies"
            />
          </div>
        )}
      </div>
    </div>
  )
}
