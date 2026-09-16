'use client'

import { useState, useMemo } from 'react'
import {
  PhoneCall,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  UserX,
  Search,
  Filter,
  Eye,
  SlidersHorizontal,
  ChevronRight,
  Phone,
  MessageSquare,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TablePager, pageSlice, type InsurancePageSize } from '@/features/insurance/table-pager'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import type { RenewalDue, RenewalPipeline } from '@/lib/insurance/renewals'
import type { CrmDisposition } from '@/lib/insurance/crm'

type Props = {
  brand: InsuranceBrandId
  pipelineData: RenewalPipeline | undefined
  isLoading: boolean
  canEdit: boolean
  onOpenCrm: (lead: RenewalDue) => void
  onInspectPolicy: (record: any) => void
  pageSize: InsurancePageSize
  onPageSizeChange: (size: InsurancePageSize) => void
}

const CRM_BADGE_STYLES: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pending Call', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  INTERESTED: { label: 'Interested', className: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 font-bold' },
  FOLLOWUP_SCHEDULED: { label: 'Follow-up', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold' },
  RENEWED_WON: { label: 'Renewed', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold' },
  LOST_COMPETITOR: { label: 'Lost: Competitor', className: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' },
  LOST_ONLINE: { label: 'Lost: Online', className: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' },
  LOST_PRICE: { label: 'Lost: Price', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  SOLD_VEHICLE: { label: 'Sold Vehicle', className: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
  WRONG_NUMBER: { label: 'Invalid #', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  NOT_INTERESTED: { label: 'Refused', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
}

export function RenewalsCrmWorkspace({
  brand,
  pipelineData,
  isLoading,
  canEdit,
  onOpenCrm,
  onInspectPolicy,
  pageSize,
  onPageSizeChange,
}: Props) {
  const [urgencyBucket, setUrgencyBucket] = useState<'all' | 'critical_7' | 'urgent_15' | 'standard_30' | 'lost_6m'>('all')
  const [dispositionFilter, setDispositionFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  // Source list based on selected urgency bucket
  const sourceRows = useMemo(() => {
    if (!pipelineData) return []
    if (urgencyBucket === 'lost_6m') return pipelineData.lost6mRows || []
    const upcoming = pipelineData.upcoming30Rows || []
    if (urgencyBucket === 'all') return upcoming
    return upcoming.filter((r) => r.urgencySubBucket === urgencyBucket)
  }, [pipelineData, urgencyBucket])

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = sourceRows
    if (dispositionFilter !== 'all') {
      rows = rows.filter((r) => (r.disposition || 'PENDING') === dispositionFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      rows = rows.filter(
        (r) =>
          r.customerName?.toLowerCase().includes(q) ||
          r.chassisNo?.toLowerCase().includes(q) ||
          r.policyNo?.toLowerCase().includes(q) ||
          r.model?.toLowerCase().includes(q) ||
          r.registrationNo?.toLowerCase().includes(q),
      )
    }
    return rows
  }, [sourceRows, dispositionFilter, searchQuery])

  // Paginated rows
  const pagedSlice = useMemo(() => pageSlice(filteredRows, page, pageSize), [filteredRows, page, pageSize])
  const pagedRows = pagedSlice.rows
  const totalPages = pagedSlice.totalPages

  // Counters for urgency tabs
  const criticalCount = useMemo(
    () => (pipelineData?.upcoming30Rows || []).filter((r) => r.urgencySubBucket === 'critical_7').length,
    [pipelineData?.upcoming30Rows],
  )
  const urgentCount = useMemo(
    () => (pipelineData?.upcoming30Rows || []).filter((r) => r.urgencySubBucket === 'urgent_15').length,
    [pipelineData?.upcoming30Rows],
  )
  const standardCount = useMemo(
    () => (pipelineData?.upcoming30Rows || []).filter((r) => r.urgencySubBucket === 'standard_30').length,
    [pipelineData?.upcoming30Rows],
  )
  const lostCount = pipelineData?.lost6mRows?.length || 0

  return (
    <div className="space-y-4">
      {/* Control Bar: Urgency Triage Tabs + Search + Disposition Filter */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Urgency Pill Toggles */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => {
                setUrgencyBucket('all')
                setPage(1)
              }}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                urgencyBucket === 'all'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900',
              )}
            >
              Upcoming 30d ({(pipelineData?.upcoming30Rows || []).length})
            </button>

            <button
              type="button"
              onClick={() => {
                setUrgencyBucket('critical_7')
                setPage(1)
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                urgencyBucket === 'critical_7'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 hover:bg-rose-100',
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              <span>Critical ≤7d ({criticalCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setUrgencyBucket('urgent_15')
                setPage(1)
              }}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                urgencyBucket === 'urgent_15'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 hover:bg-amber-100',
              )}
            >
              Urgent 8-15d ({urgentCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setUrgencyBucket('standard_30')
                setPage(1)
              }}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                urgencyBucket === 'standard_30'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900',
              )}
            >
              Standard 16-30d ({standardCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setUrgencyBucket('lost_6m')
                setPage(1)
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                urgencyBucket === 'lost_6m'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 hover:bg-purple-100',
              )}
            >
              <UserX className="h-3 w-3" />
              <span>Lost Customers 6M ({lostCount})</span>
            </button>
          </div>

          {/* Quick Search and Disposition Filter */}
          <div className="flex items-center gap-2">
            <div className="relative w-48 sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search lead or VIN..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                className="h-8 pl-8 rounded-xl text-xs"
              />
            </div>

            <Select
              value={dispositionFilter}
              onValueChange={(val) => {
                setDispositionFilter(val)
                setPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-36 rounded-xl text-xs font-semibold">
                <SelectValue placeholder="Call Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dispositions</SelectItem>
                <SelectItem value="PENDING">Pending Call</SelectItem>
                <SelectItem value="INTERESTED">Interested</SelectItem>
                <SelectItem value="FOLLOWUP_SCHEDULED">Follow-up</SelectItem>
                <SelectItem value="RENEWED_WON">Renewed</SelectItem>
                <SelectItem value="LOST_COMPETITOR">Lost: Competitor</SelectItem>
                <SelectItem value="LOST_ONLINE">Lost: Online</SelectItem>
                <SelectItem value="LOST_PRICE">Lost: Price</SelectItem>
                <SelectItem value="SOLD_VEHICLE">Sold Vehicle</SelectItem>
                <SelectItem value="NOT_INTERESTED">Refused</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Main Calling Desk Table */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
            <TableRow>
              <TableHead className="w-12 text-[10px] font-bold uppercase tracking-wider">#</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Customer & Vehicle</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Chassis (VIN)</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Expiry & Urgency</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Insurer</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-wider">Call Disposition</TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider pr-4">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-xs text-slate-400">
                  Loading renewals pipeline...
                </TableCell>
              </TableRow>
            ) : pagedRows.length > 0 ? (
              pagedRows.map((lead: RenewalDue, idx: number) => {
                const rowNum = (page - 1) * pageSize + idx + 1
                const badgeInfo = CRM_BADGE_STYLES[lead.disposition || 'PENDING'] || CRM_BADGE_STYLES.PENDING
                const days = lead.daysToExpiry ?? 0

                return (
                  <TableRow
                    key={lead.chassisNo || idx}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-slate-400 font-medium">
                      {rowNum}
                    </TableCell>

                    <TableCell>
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {lead.customerName || 'Customer'}
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        {lead.model || 'Vehicle'} {lead.variant ? `• ${lead.variant}` : ''}
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {lead.chassisNo}
                      </span>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5',
                            days <= 7
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              : days <= 15
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
                          )}
                        >
                          {days <= 0 ? 'Expired' : `${days}d left`}
                        </Badge>
                        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                          {lead.expiryDate || '—'}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {lead.insuranceCompany || '—'}
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary" className={cn('text-[10px] font-semibold', badgeInfo.className)}>
                        {badgeInfo.label}
                      </Badge>
                      {lead.remarks && (
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[160px]">
                          {lead.remarks}
                        </p>
                      )}
                    </TableCell>

                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onInspectPolicy(lead)}
                          className="h-7 px-2 text-[11px] font-semibold gap-1 rounded-lg border-slate-200 dark:border-slate-700"
                        >
                          <Eye className="h-3 w-3" />
                          <span className="hidden sm:inline">Details</span>
                        </Button>

                        {canEdit && (
                          <Button
                            size="sm"
                            onClick={() => onOpenCrm(lead)}
                            className="h-7 px-2.5 text-[11px] font-bold gap-1 rounded-lg bg-[var(--dashboard-primary)] text-white shadow-xs"
                          >
                            <PhoneCall className="h-3 w-3" />
                            <span>Log Call</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-xs text-slate-400">
                  No renewal records found matching this filter criteria
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pager */}
        {filteredRows.length > 0 && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800">
            <TablePager
              page={page}
              totalPages={totalPages}
              totalRows={filteredRows.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={onPageSizeChange}
              noun="renewals"
            />
          </div>
        )}
      </div>
    </div>
  )
}
