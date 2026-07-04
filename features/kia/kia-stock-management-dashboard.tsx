'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { 
  Car, Plus, Search, RefreshCw, Loader2, ShieldCheck, FileText, 
  CheckCircle2, XCircle, Truck, WalletCards, BadgeIndianRupee, 
  Calendar, ChevronRight, AlertTriangle, AlertCircle, Share2, ClipboardList
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

type StockRow = {
  id: string
  vin_number: string
  model: string
  variant: string
  color: string
  stock_age: string
  stock_status: string
  dealer_code: string
  engine_no: string
  allocation_id: string | null
  allocation_status: string | null
  expires_at: string | null
  allocated_at: string | null
  booking_id: string | null
  booking_number: string | null
  customer_name: string | null
  customer_phone: string | null
  consultant_name: string | null
  booking_status: string | null
  bank_name: string | null
  metadata: Record<string, any> | null
  transfer_id: string | null
  transfer_status: string | null
  to_dealer_code: string | null
}

type StockPayload = {
  metrics: {
    total_vins: number
    available: number
    payment_pending: number
    payment_overdue: number
    paid_to_deliver: number
    delivered: number
    transfers: number
  }
  rows: StockRow[]
  activities: {
    id: string
    title: string
    description: string
    actor_name: string
    created_at: string
  }[]
  filters: {
    dealers: string[]
    models: string[]
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type BookingOption = {
  id: string
  bookingNumber: string
  customerName: string
  customerPhone: string
  model: string
  variant: string
}

export function KiaStockManagementDashboard() {
  const queryClient = useQueryClient()
  const router = useRouter()

  // State filters
  const [search, setSearch] = useState('')
  const [dealerCode, setDealerCode] = useState('All')
  const [model, setModel] = useState('All')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)

  // Dialog states
  const [allotDialogOpen, setAllotDialogOpen] = useState(false)
  const [allotVin, setAllotVin] = useState('')
  const [selectedBookingId, setSelectedBookingId] = useState('')

  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferVin, setTransferVin] = useState('')
  const [transferBookingId, setTransferBookingId] = useState('')
  const [transferDealer, setTransferDealer] = useState('')
  const [transferNotes, setTransferNotes] = useState('')

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentBookingId, setPaymentBookingId] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentFile, setPaymentFile] = useState<File | null>(null)

  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [releaseBookingId, setReleaseBookingId] = useState('')
  const [releaseReason, setReleaseReason] = useState('')

  const [deliverDialogOpen, setDeliverDialogOpen] = useState(false)
  const [deliverBookingId, setDeliverBookingId] = useState('')

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelBookingId, setCancelBookingId] = useState('')

  // Build query string
  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '10',
    })
    if (search) params.set('search', search)
    if (dealerCode !== 'All') params.set('dealer_code', dealerCode)
    if (model !== 'All') params.set('model', model)
    if (status !== 'All') params.set('status', status)
    return params.toString()
  }, [search, dealerCode, model, status, page])

  // Query stock data
  const { data, isLoading, isError, refetch } = useQuery<StockPayload>({
    queryKey: ['kia-proforma-stock', queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/proforma/stock?${queryParams}`)
      if (!response.ok) throw new Error('Failed to load stock data')
      return response.json()
    },
    staleTime: 10_000,
  })

  // Query approved bookings for allotment dropdown
  const { data: bookingsData } = useQuery<{ rows: BookingOption[] }>({
    queryKey: ['kia-approved-bookings-for-allot'],
    queryFn: async () => {
      const response = await fetch('/api/brands/kia/bookings?status=proforma_generated&pageSize=100')
      if (!response.ok) throw new Error('Failed to load approved bookings')
      return response.json()
    },
    enabled: allotDialogOpen || transferDialogOpen,
  })

  const bookingsList = bookingsData?.rows || []

  // Mutations
  const allotMutation = useMutation({
    mutationFn: async ({ bookingId, vin }: { bookingId: string; vin: string }) => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/allot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vinNumber: vin }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to allot vehicle')
      }
      return res.json()
    },
    onSuccess: () => {
      alert('Vehicle allotted successfully!')
      setAllotDialogOpen(false)
      setSelectedBookingId('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => alert(err.message),
  })

  const transferMutation = useMutation({
    mutationFn: async ({ bookingId, vin, toDealerCode, notes }: { bookingId: string; vin: string; toDealerCode: string; notes: string }) => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vinNumber: vin, toDealerCode, notes }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to request transfer')
      }
      return res.json()
    },
    onSuccess: () => {
      alert('Vehicle transfer requested successfully!')
      setTransferDialogOpen(false)
      setTransferNotes('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => alert(err.message),
  })

  const paymentMutation = useMutation({
    mutationFn: async ({ bookingId, reference, file }: { bookingId: string; reference: string; file: File | null }) => {
      const formData = new FormData()
      formData.append('reference', reference)
      if (file) formData.append('invoice', file)

      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/payment`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to confirm payment')
      }
      return res.json()
    },
    onSuccess: () => {
      alert('Payment confirmed successfully!')
      setPaymentDialogOpen(false)
      setPaymentReference('')
      setPaymentFile(null)
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => alert(err.message),
  })

  const releaseMutation = useMutation({
    mutationFn: async ({ bookingId, reason }: { bookingId: string; reason: string }) => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to release vehicle')
      }
      return res.json()
    },
    onSuccess: () => {
      alert('Vehicle released successfully!')
      setReleaseDialogOpen(false)
      setReleaseReason('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => alert(err.message),
  })

  const deliverMutation = useMutation({
    mutationFn: async ({ bookingId }: { bookingId: string }) => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/deliver`, {
        method: 'POST',
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to deliver vehicle')
      }
      return res.json()
    },
    onSuccess: () => {
      alert('Vehicle marked as delivered!')
      setDeliverDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => alert(err.message),
  })

  const cancelMutation = useMutation({
    mutationFn: async ({ bookingId }: { bookingId: string }) => {
      // Releasing allocation and cancelling booking status
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Customer cancelled booking' }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to cancel allocation')
      }
      return res.json()
    },
    onSuccess: () => {
      alert('Allocation cancelled successfully!')
      setCancelDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => alert(err.message),
  })

  // Format Helpers
  const formatAge = (ageStr: string) => {
    const age = parseInt(ageStr) || 0
    let color = 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (age >= 90) {
      color = 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
    } else if (age >= 30) {
      color = 'bg-amber-50 text-amber-800 border-amber-200'
    }
    return (
      <Badge variant="outline" className={`rounded-xl px-2 py-0.5 text-xs font-black border ${color}`}>
        {age}d
      </Badge>
    )
  }

  const formatClock = (row: StockRow) => {
    if (!row.booking_id) return <span className="text-slate-400 font-semibold">-</span>

    if (row.booking_status === 'ready_delivery') {
      return (
        <span className="inline-flex items-center rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
          paid · waiting 2d for delivery
        </span>
      )
    }

    if (row.expires_at) {
      const expiration = new Date(row.expires_at).getTime()
      const now = Date.now()
      const diffMs = expiration - now

      if (diffMs <= 0) {
        const hoursOverdue = Math.abs(Math.floor(diffMs / (60 * 60 * 1000)))
        return (
          <span className="inline-flex items-center rounded-xl bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700 border border-rose-200 animate-pulse">
            PAYMENT OVERDUE · {hoursOverdue}h
          </span>
        )
      } else {
        const hoursLeft = Math.floor(diffMs / (60 * 60 * 1000))
        return (
          <span className="inline-flex items-center rounded-xl bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700 border border-emerald-200">
            {hoursLeft}h to pay
          </span>
        )
      }
    }

    return <span className="text-slate-400 font-semibold">-</span>
  }

  const renderStatus = (row: StockRow) => {
    if (!row.allocation_id) {
      return <Badge className="rounded-full border border-rose-200 bg-rose-50 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-rose-700">AVAILABLE</Badge>
    }
    if (row.booking_status === 'ready_delivery') {
      return <Badge className="rounded-full border border-teal-200 bg-teal-50 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-teal-700">PAID - TO DELIVER</Badge>
    }
    if (row.booking_status === 'delivered') {
      return <Badge className="rounded-full border border-green-200 bg-green-50 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-green-700">DELIVERED</Badge>
    }
    return <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">ALLOTTED</Badge>
  }

  // Activity icon mapping
  const getActivityIcon = (title: string) => {
    const t = title.toLowerCase()
    if (t.includes('allot') || t.includes('vin')) return <BadgeIndianRupee className="h-4 w-4 text-emerald-600" />
    if (t.includes('transfer')) return <Car className="h-4 w-4 text-cyan-600" />
    if (t.includes('payment') || t.includes('paid')) return <ShieldCheck className="h-4 w-4 text-indigo-600" />
    if (t.includes('deliver')) return <Truck className="h-4 w-4 text-teal-600" />
    return <ClipboardList className="h-4 w-4 text-slate-600" />
  }

  const dealerFilters = data?.filters?.dealers || ['JK402', 'JK501']
  const modelFilters = data?.filters?.models || ['CARENS', 'SELTOS', 'SONET', 'CARENS CLAVIS EV']

  const handleShareStock = () => {
    if (!data?.rows) return
    const text = data.rows.map(r => `${r.model} ${r.variant} (${r.color}) - VIN: ${r.vin_number} - Status: ${r.allocation_id ? 'Allotted' : 'Available'}`).join('\n')
    navigator.clipboard.writeText(text).then(() => alert('Stock report copied to clipboard!'))
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* 1. Metrics Grid */}
      {data?.metrics && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: 'TOTAL VINS', val: data.metrics.total_vins, color: 'border-slate-200 bg-white text-slate-900' },
            { label: 'AVAILABLE', val: data.metrics.available, color: 'border-rose-100 bg-white text-rose-700' },
            { label: 'PAYMENT PENDING', val: data.metrics.payment_pending, color: 'border-indigo-100 bg-white text-indigo-700' },
            { label: 'PAYMENT OVERDUE', val: data.metrics.payment_overdue, color: 'border-rose-200 bg-rose-50 text-rose-700' },
            { label: 'PAID - TO DELIVER', val: data.metrics.paid_to_deliver, color: 'border-teal-100 bg-white text-teal-700' },
            { label: 'DELIVERED', val: data.metrics.delivered, color: 'border-green-100 bg-white text-green-700' },
            { label: 'TRANSFERS', val: data.metrics.transfers, color: 'border-cyan-100 bg-white text-cyan-700' },
          ].map((card, i) => (
            <div key={i} className={`flex flex-col justify-between rounded-xl border p-3 shadow-sm ${card.color}`}>
              <span className="text-[9px] font-black uppercase tracking-wider opacity-70">{card.label}</span>
              <span className="mt-1.5 text-xl font-black tracking-tight">{card.val}</span>
            </div>
          ))}
        </div>
      )}

      {/* 2. Filters + Table + Activity (stacked) */}
      <div className="w-full min-w-0 space-y-4">
        <div className="w-full min-w-0 space-y-4">
          {/* Filters Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Dealer selector */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1.5">DEALER</span>
                <Button 
                  size="sm" 
                  variant={dealerCode === 'All' ? 'default' : 'outline'}
                  className="h-8 rounded-xl text-xs font-bold"
                  onClick={() => { setDealerCode('All'); setPage(1) }}
                >
                  All
                </Button>
                {dealerFilters.map((d) => (
                  <Button 
                    key={d}
                    size="sm" 
                    variant={dealerCode === d ? 'default' : 'outline'}
                    className="h-8 rounded-xl text-xs font-bold"
                    onClick={() => { setDealerCode(d); setPage(1) }}
                  >
                    {d === 'JK402' ? 'JK402 Jammu' : d === 'JK501' ? 'JK501 Udhampur' : d}
                  </Button>
                ))}
              </div>

              {/* Share button */}
              <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs font-black border-slate-200 bg-white" onClick={handleShareStock}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share stock
              </Button>
            </div>

            {/* Model selector */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1.5">MODEL</span>
              <Button 
                size="sm" 
                variant={model === 'All' ? 'default' : 'outline'}
                className="h-8 rounded-xl text-xs font-bold"
                onClick={() => { setModel('All'); setPage(1) }}
              >
                All
              </Button>
              {modelFilters.map((m) => (
                <Button 
                  key={m}
                  size="sm" 
                  variant={model === m ? 'default' : 'outline'}
                  className="h-8 rounded-xl text-xs font-bold"
                  onClick={() => { setModel(m); setPage(1) }}
                >
                  {m}
                </Button>
              ))}
            </div>

            {/* Search Input & Status Filter */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 pt-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input 
                  value={search} 
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }} 
                  placeholder="search VIN, customer, consultant..." 
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 text-xs font-semibold" 
                />
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500 whitespace-nowrap">Filter Status:</span>
                <Select value={status} onValueChange={(val) => { setStatus(val); setPage(1) }}>
                  <SelectTrigger className="h-9 w-40 rounded-xl border-slate-200 text-xs font-bold">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-200">
                    <SelectItem value="All" className="text-xs font-bold">All</SelectItem>
                    <SelectItem value="AVAILABLE" className="text-xs font-bold">Available</SelectItem>
                    <SelectItem value="ALLOTTED" className="text-xs font-bold">Allotted</SelectItem>
                    <SelectItem value="PAID_TO_DELIVER" className="text-xs font-bold">Paid - To Deliver</SelectItem>
                    <SelectItem value="DELIVERED" className="text-xs font-bold">Delivered</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="outline" className="h-9 w-9 rounded-xl border-slate-200 bg-white p-0" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 text-slate-600" />
                </Button>
              </div>
            </div>
          </div>

          {/* Main Table — scroll horizontally if needed */}
          {isLoading ? (
            <div className="flex h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Loading Stock...</span>
              </div>
            </div>
          ) : isError ? (
            <div className="flex h-64 items-center justify-center rounded-3xl border border-rose-200 bg-rose-50 text-rose-700 font-bold">
              Failed to load stock data. Refresh the page to retry.
            </div>
          ) : data?.rows.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white p-6 text-center">
              <Car className="h-10 w-10 text-slate-300" />
              <h3 className="mt-3 text-sm font-black text-slate-900">No stock vehicles found</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">Adjust your search query or filters to browse available inventory.</p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <Table className="w-full min-w-[900px]">
                <TableHeader className="bg-slate-950 hover:bg-slate-950">
                  <TableRow className="hover:bg-slate-950 border-b-none">
                    {['STATUS', 'CAR', 'COLOUR', 'AGE', 'DEALER', 'CUSTOMER', 'TEAM', 'FINANCIER', 'CLOCK', 'ACTIONS'].map((h) => (
                      <TableHead key={h} className="h-9 px-2 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.rows.map((row) => (
                    <TableRow key={row.id} className="hover:bg-slate-50 border-b border-slate-100">
                      {/* STATUS */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap">{renderStatus(row)}</TableCell>

                      {/* CAR */}
                      <TableCell className="px-2 py-2 align-middle">
                        <div className="font-black text-slate-950 text-[11px] uppercase whitespace-nowrap">{row.model || '-'}</div>
                        <div className="text-[10px] font-bold text-slate-500 max-w-[160px] truncate">{row.variant || '-'}</div>
                        <code className="mt-0.5 inline-block font-mono text-[9px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-600">
                          {row.vin_number}
                        </code>
                      </TableCell>

                      {/* COLOUR */}
                      <TableCell className="px-2 py-2 align-middle text-[10px] font-semibold text-slate-600 max-w-[100px]">
                        <div className="truncate max-w-[100px]">{row.color || '-'}</div>
                      </TableCell>

                      {/* AGE */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap">{formatAge(row.stock_age)}</TableCell>

                      {/* DEALER */}
                      <TableCell className="px-2 py-2 align-middle text-[10px] font-bold text-slate-700 whitespace-nowrap">{row.dealer_code || '-'}</TableCell>

                      {/* CUSTOMER */}
                      <TableCell className="px-2 py-2 align-middle">
                        {row.booking_id ? (
                          <div className="space-y-0.5 min-w-[120px]">
                            <div className="text-[11px] font-black text-slate-900 leading-tight truncate max-w-[130px]">{row.customer_name}</div>
                            <div className="text-[9px] font-bold text-slate-500">{row.customer_phone}</div>
                            <div className="text-[9px] font-black text-slate-400">#{row.booking_number}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[10px] font-semibold">-</span>
                        )}
                      </TableCell>

                      {/* TEAM */}
                      <TableCell className="px-2 py-2 align-middle">
                        {row.booking_id ? (
                          <div className="text-[9px] font-bold text-slate-600 space-y-0.5 min-w-[80px]">
                            <div className="truncate max-w-[90px]">SC: {row.consultant_name}</div>
                            {row.metadata?.tlName && <div className="truncate max-w-[90px]">TL: {row.metadata.tlName}</div>}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[10px] font-semibold">-</span>
                        )}
                      </TableCell>

                      {/* FINANCIER */}
                      <TableCell className="px-2 py-2 align-middle text-[10px] font-bold text-slate-600 whitespace-nowrap">{row.bank_name || '-'}</TableCell>

                      {/* CLOCK */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap">{formatClock(row)}</TableCell>

                      {/* ACTIONS */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {!row.allocation_id ? (
                            <>
                              <Button 
                                size="sm" 
                                className="h-7 rounded-lg bg-slate-950 px-2.5 text-[10px] font-black text-white hover:bg-slate-800"
                                onClick={() => { setAllotVin(row.vin_number); setAllotDialogOpen(true) }}
                              >
                                Allot
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-7 rounded-lg border-slate-200 px-2 text-[10px] font-black text-slate-800"
                                onClick={() => { 
                                  setTransferVin(row.vin_number)
                                  setTransferBookingId(row.booking_id || '')
                                  setTransferDialogOpen(true) 
                                }}
                              >
                                Transfer
                              </Button>
                            </>
                          ) : row.booking_status === 'ready_delivery' ? (
                            <>
                              <Button 
                                size="sm" 
                                className="h-7 rounded-lg bg-slate-950 px-2.5 text-[10px] font-black text-white hover:bg-slate-800"
                                onClick={() => { setDeliverBookingId(row.booking_id || ''); setDeliverDialogOpen(true) }}
                              >
                                Delivered
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-7 rounded-lg border-slate-200 px-2 text-[10px] font-black text-slate-800 hover:bg-rose-50 hover:text-rose-700"
                                onClick={() => { setCancelBookingId(row.booking_id || ''); setCancelDialogOpen(true) }}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button 
                                size="sm" 
                                className="h-7 rounded-lg bg-slate-950 px-2.5 text-[10px] font-black text-white hover:bg-slate-800"
                                onClick={() => { setPaymentBookingId(row.booking_id || ''); setPaymentDialogOpen(true) }}
                              >
                                Payment received
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-7 rounded-lg border-slate-200 px-2 text-[10px] font-black text-slate-800 hover:bg-rose-50 hover:text-rose-700"
                                onClick={() => { setReleaseBookingId(row.booking_id || ''); setReleaseDialogOpen(true) }}
                              >
                                Release
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data?.pagination && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/50">
                  <span className="text-xs font-semibold text-slate-500">
                    Showing Page {data.pagination.page} of {data.pagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-8 rounded-lg text-xs font-bold"
                      disabled={page === 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-8 rounded-lg text-xs font-bold"
                      disabled={page === data?.pagination?.totalPages}
                      onClick={() => setPage(p => Math.min(data?.pagination?.totalPages || 1, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Activity Log — horizontal strip below the table */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <ClipboardList className="h-4 w-4 text-slate-500" />
            <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Activity Log</h3>
          </div>
          <div className="divide-y divide-slate-50 max-h-52 overflow-y-auto">
            {data?.activities && data.activities.length > 0 ? (
              data.activities.map((act) => (
                <div key={act.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-slate-50 border border-slate-200">
                    {getActivityIcon(act.title)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-slate-900 leading-tight">
                      <span className="font-black">{act.actor_name}</span>{' '}
                      {act.title.toLowerCase().replace('vin', 'VIN')}{' '}
                      <span className="text-slate-500">{act.description}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                      {new Date(act.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
                      })}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs font-semibold text-slate-400 text-center py-6">No recent actions recorded.</p>
            )}
          </div>
        </div>
      </div>

      {/* 4. Dialogs */}

      {/* ALLOT DIALOG */}
      <Dialog open={allotDialogOpen} onOpenChange={setAllotDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5 border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-950">Allot Vehicle</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              Select an approved booking to link to VIN <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-700">{allotVin}</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Select Approved Booking</label>
              <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
                <SelectTrigger className="h-10 rounded-xl border-slate-200 text-xs font-semibold">
                  <SelectValue placeholder="Choose a booking..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 max-h-[300px]">
                  {bookingsList.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.bookingNumber} - {b.customerName} ({b.model})
                    </SelectItem>
                  ))}
                  {bookingsList.length === 0 && (
                    <div className="text-xs font-semibold text-slate-400 text-center py-2">No bookings waiting for allocation.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setAllotDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800"
              disabled={allotMutation.isPending || !selectedBookingId}
              onClick={() => allotMutation.mutate({ bookingId: selectedBookingId, vin: allotVin })}
            >
              {allotMutation.isPending ? 'Allotting...' : 'Confirm Allotment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TRANSFER DIALOG */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5 border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-950">Request Vehicle Transfer</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              Initiate a transfer request for VIN <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-700">{transferVin}</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-2">
            {/* If no booking_id, we need to associate one first */}
            {!transferBookingId && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Select Booking</label>
                <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
                  <SelectTrigger className="h-10 rounded-xl border-slate-200 text-xs font-semibold">
                    <SelectValue placeholder="Choose a booking..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-200 max-h-[200px]">
                    {bookingsList.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-xs">
                        {b.bookingNumber} - {b.customerName} ({b.model})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Target Dealer Code</label>
              <Select value={transferDealer} onValueChange={setTransferDealer}>
                <SelectTrigger className="h-10 rounded-xl border-slate-200 text-xs font-semibold">
                  <SelectValue placeholder="Choose target outlet..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200">
                  <SelectItem value="JK402" className="text-xs">JK402 Jammu</SelectItem>
                  <SelectItem value="JK501" className="text-xs">JK501 Udhampur</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Transfer Notes</label>
              <Input 
                value={transferNotes} 
                onChange={(e) => setTransferNotes(e.target.value)} 
                placeholder="Reason for transfer, timeline details..." 
                className="h-10 rounded-xl border border-slate-200 text-xs font-semibold" 
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setTransferDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800"
              disabled={transferMutation.isPending || !transferDealer || (!transferBookingId && !selectedBookingId)}
              onClick={() => transferMutation.mutate({ 
                bookingId: transferBookingId || selectedBookingId, 
                vin: transferVin, 
                toDealerCode: transferDealer, 
                notes: transferNotes 
              })}
            >
              {transferMutation.isPending ? 'Requesting...' : 'Confirm Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PAYMENT RECEIVED DIALOG */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5 border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-950">Confirm Payment Receipt</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              Confirm payment receipt and upload the customer invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Payment Reference No.</label>
              <Input 
                value={paymentReference} 
                onChange={(e) => setPaymentReference(e.target.value)} 
                placeholder="Txn ID, Receipt No., Bank reference..." 
                className="h-10 rounded-xl border border-slate-200 text-xs font-semibold" 
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Invoice PDF Document</label>
              <Input 
                type="file" 
                accept=".pdf,.png,.jpg,.jpeg" 
                onChange={(e) => setPaymentFile(e.target.files?.[0] || null)} 
                className="h-10 rounded-xl border border-slate-200 text-xs pt-2" 
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800"
              disabled={paymentMutation.isPending || !paymentReference}
              onClick={() => paymentMutation.mutate({ 
                bookingId: paymentBookingId, 
                reference: paymentReference, 
                file: paymentFile 
              })}
            >
              {paymentMutation.isPending ? 'Submitting...' : 'Confirm Receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RELEASE DIALOG */}
      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5 border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-950">Release VIN Allocation</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500 text-rose-600">
              Are you sure you want to release the allocated VIN? This will put the booking back into the "Waiting Allocation" status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Release Reason</label>
              <Input 
                value={releaseReason} 
                onChange={(e) => setReleaseReason(e.target.value)} 
                placeholder="Reason for releasing allocation..." 
                className="h-10 rounded-xl border border-slate-200 text-xs font-semibold" 
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setReleaseDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700"
              disabled={releaseMutation.isPending || !releaseReason}
              onClick={() => releaseMutation.mutate({ 
                bookingId: releaseBookingId, 
                reason: releaseReason 
              })}
            >
              {releaseMutation.isPending ? 'Releasing...' : 'Release VIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELIVER DIALOG */}
      <Dialog open={deliverDialogOpen} onOpenChange={setDeliverDialogOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-5 border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-950">Confirm Vehicle Delivery</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              Confirm that the vehicle has been handed over to the customer. This changes status to "Delivered" and archives the active allotment countdown.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setDeliverDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800"
              disabled={deliverMutation.isPending}
              onClick={() => deliverMutation.mutate({ bookingId: deliverBookingId })}
            >
              {deliverMutation.isPending ? 'Delivering...' : 'Confirm Delivery'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCEL ALLOCATION DIALOG */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-5 border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-950">Cancel Allocation</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500 text-rose-600">
              Are you sure you want to cancel the allocation for this booking? The VIN will be released and returned to general available stock.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setCancelDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate({ bookingId: cancelBookingId })}
            >
              {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
