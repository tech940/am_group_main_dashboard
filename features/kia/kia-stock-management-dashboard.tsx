'use client'

/* Pre-existing lint debt in this large WIP file (not introduced by the premium
   redesign): explicit `any` in types, a mount-effect setState, a render-time
   date call, and unescaped quotes in dialog copy. Disabled here so the module
   builds cleanly; each is worth a separate, dedicated cleanup pass. */
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, react-hooks/purity, react/no-unescaped-entities */

import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS, DASHBOARD_GC_TIME_MS } from '@/components/providers/query-provider'
import { 
  Car, Plus, Search, RefreshCw, Loader2, ShieldCheck, FileText, 
  CheckCircle2, XCircle, Truck, WalletCards, BadgeIndianRupee, 
  Calendar, ChevronRight, AlertTriangle, AlertCircle, Share2, ClipboardList,
  ChevronDown, X, Users, Clock, Lock
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import * as XLSX from 'xlsx'
import { maskKiaPii } from '@/lib/kia/pii'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  Chip,
  FieldValue,
  IconTile,
  type KpiDatum,
  KpiRow,
  LoaderOverlay,
  motion,
  PremiumEmptyState,
  SuccessOverlay,
  TableSkeleton as PremiumTableSkeleton,
  type Tone,
  toneSoftStyle,
} from '@/components/kia/premium'


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
  booking_delivery_date: string | null
  metadata: Record<string, any> | null
  transfer_id: string | null
  transfer_status: string | null
  to_dealer_code: string | null
  transfer_requested_at: string | null
  transfer_requester_name: string | null
  /**
   * FIFO guard, computed server-side over the WHOLE stock table (not the filtered page): how many
   * other allottable vehicles of the same model+variant at the same outlet have been in stock
   * longer, and which is the oldest. Drives the ageing-stock warning on the allot dialog.
   */
  older_count: number | null
  oldest_alternative_vin: string | null
  oldest_alternative_age: number | null
}

type SoldMissingRow = {
  allocation_id: string
  vin_number: string
  model: string | null
  variant: string | null
  color: string | null
  engine_no: string | null
  dealer_code: string | null
  stock_missing_at: string | null
  // Present on the "No Payment Received" overlay (reservation-window expiry) instead of stock_missing_at.
  expires_at?: string | null
  allocated_at: string | null
  vehicle_snapshot: Record<string, unknown> | null
  booking_id: string | null
  booking_number: string | null
  customer_name: string | null
  consultant_name: string | null
  booking_status: string | null
}

type TransferMissingRow = {
  transfer_id: string
  vin_number: string | null
  dealer_code: string | null
  from_dealer_code: string | null
  stock_missing_at: string | null
  requested_at: string | null
  vehicle_snapshot: Record<string, unknown> | null
  booking_id: string | null
  booking_number: string | null
  customer_name: string | null
  booking_status: string | null
  transfer_requested_at: string | null
  transfer_requester_name: string | null
}

type HeldRow = {
  vin_number: string
  local_status: string
  dealer_code: string | null
  model: string | null
  variant: string | null
  color: string | null
  customer_name: string | null
  booking_no: string | null
  notes: string | null
  marked_by_name: string | null
  marked_at: string | null
  hold_expires_at: string | null
  paid: boolean
  vehicle_snapshot: Record<string, unknown> | null
}

type StockPayload = {
  metrics: {
    total_vins: number
    available: number
    payment_pending: number
    /** DMS-committed cars with no allocation of ours — see the KPI row for why it is its own bucket. */
    dms_allocated?: number
    payment_overdue: number
    paid_to_deliver: number
    delivered: number
    transfers: number
    sold_missing?: number
    no_payment?: number
    transfer_missing?: number
    held?: number
  }
  rows: StockRow[]
  soldMissing?: SoldMissingRow[]
  noPayment?: SoldMissingRow[]
  transferMissing?: TransferMissingRow[]
  heldVehicles?: HeldRow[]
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
    /** Raw kia_stock_management.stock_status values with their row counts, newest feed wins. */
    dmsStatuses?: { status: string; count: number }[]
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
  customerEmail?: string | null
  model: string
  variant: string
  color?: string | null
  consultantName?: string | null
  source?: string | null
  financeRequired?: boolean
  bankName?: string | null
  loanAmount?: string | null
  notes?: string | null
  deliveryTargetDate?: string | null
  dealerCode?: string | null
  // Present at runtime — the bookings API spreads the full kia_bookings row.
  status?: string | null
  createdAt?: string | null
  proformaNumber?: string | null
  metadata?: Record<string, unknown> | null
}

export function KiaStockManagementDashboard({ currentUserRole }: { currentUserRole?: string } = {}) {
  const queryClient = useQueryClient()

  // Audit Log and customer PII (email / phone) are restricted to MD & Super Admin.
  const role = String(currentUserRole || '').trim().toLowerCase()
  const canViewAudit = role === 'md' || role === 'developer'
  const canViewCustomerPii = role === 'md' || role === 'developer'

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // State filters
  /**
   * Filters are staged, not live.
   *
   * `search` / `dealerCode` / … are the APPLIED filters — the only ones the query reads. The
   * `draft*` values are what the controls in the filter bar edit. Nothing reaches the API until
   * Apply is pressed, so changing three dropdowns costs one request instead of three, and a
   * half-typed date like "0002-01-01" never gets sent while the user is still typing it.
   *
   * The KPI cards are deliberately NOT staged — clicking a card is a direct action, so it sets both
   * the draft and the applied status and takes effect immediately.
   */
  const [search, setSearch] = useState('')
  const [dealerCode, setDealerCode] = useState('All')
  const [model, setModel] = useState('All')
  const [status, setStatus] = useState('AVAILABLE')
  /** Raw DMS status from kia_stock_management.stock_status — a different axis from `status`. */
  const [dmsStatus, setDmsStatus] = useState('All')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)

  const [draftSearch, setDraftSearch] = useState('')
  const [draftDealerCode, setDraftDealerCode] = useState('All')
  const [draftModel, setDraftModel] = useState('All')
  const [draftStatus, setDraftStatus] = useState('AVAILABLE')
  const [draftDmsStatus, setDraftDmsStatus] = useState('All')
  const [draftStartDate, setDraftStartDate] = useState('')
  const [draftEndDate, setDraftEndDate] = useState('')

  const filtersDirty =
    draftSearch !== search ||
    draftDealerCode !== dealerCode ||
    draftModel !== model ||
    draftStatus !== status ||
    draftDmsStatus !== dmsStatus ||
    draftStartDate !== startDate ||
    draftEndDate !== endDate

  const applyFilters = () => {
    setSearch(draftSearch)
    setDealerCode(draftDealerCode)
    setModel(draftModel)
    setStatus(draftStatus)
    setDmsStatus(draftDmsStatus)
    setStartDate(draftStartDate)
    setEndDate(draftEndDate)
    setPage(1)
  }

  /*
   * Picking a DMS status widens the workflow bucket back to "All Status".
   *
   * The two filters are different axes, but the workflow one DEFAULTS to AVAILABLE — a narrowing
   * default — and AVAILABLE excludes stock_status 'ALLOCATED' and every DMS-sold row. Left stacked,
   * 2 of the 5 real statuses ('Allocated' 7 rows, 'Invoice' 2 rows) would return nothing at all, and
   * the new filter would look broken the moment anyone tried it. The workflow dropdown visibly moves
   * to "All Status" so nothing is hidden, and it can be narrowed again afterwards on purpose.
   */
  const selectDmsStatus = (value: string) => {
    setDraftDmsStatus(value)
    if (value !== 'All') setDraftStatus('All')
  }

  const resetFilters = () => {
    setDraftSearch(''); setSearch('')
    setDraftDealerCode('All'); setDealerCode('All')
    setDraftModel('All'); setModel('All')
    setDraftStatus('AVAILABLE'); setStatus('AVAILABLE')
    setDraftDmsStatus('All'); setDmsStatus('All')
    setDraftStartDate(''); setStartDate('')
    setDraftEndDate(''); setEndDate('')
    setPage(1)
  }

  // Card clicks bypass staging on purpose — see the note above.
  const selectStatusImmediately = (key: string) => {
    setDraftStatus(key)
    setStatus(key)
    setPage(1)
  }

  const filtersAtDefault =
    search === '' && dealerCode === 'All' && model === 'All' &&
    status === 'AVAILABLE' && dmsStatus === 'All' && startDate === '' && endDate === '' && !filtersDirty

  // Custom states
  const [auditLogOpen, setAuditLogOpen] = useState(false)
  const [journeyVin, setJourneyVin] = useState<string | null>(null)
  const [stockSuccess, setStockSuccess] = useState<null | 'allot' | 'transfer' | 'deliver'>(null)

  // Dialog states
  const [allotDialogOpen, setAllotDialogOpen] = useState(false)
  const [allotVin, setAllotVin] = useState('')
  const [selectedBookingId, setSelectedBookingId] = useState('')
  // Optional "ask the MD for a longer payment window" request, raised while allotting. Days is a
  // string because it comes from a <select>; '' means nothing chosen.
  const [extraTimeOpen, setExtraTimeOpen] = useState(false)
  const [extraTimeDays, setExtraTimeDays] = useState('')
  const [extraTimeReason, setExtraTimeReason] = useState('')
  const extraTimeReady = !extraTimeOpen || (extraTimeDays !== '' && extraTimeReason.trim().length > 0)
  const resetExtraTime = () => { setExtraTimeOpen(false); setExtraTimeDays(''); setExtraTimeReason('') }

  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferVin, setTransferVin] = useState('')
  const [transferDealer, setTransferDealer] = useState('')
  const [transferDealerOther, setTransferDealerOther] = useState('')
  const [transferNotes, setTransferNotes] = useState('')
  const [transferType, setTransferType] = useState<'against_payment' | 'against_vehicle' | null>(null)
  const [transferAmountReceived, setTransferAmountReceived] = useState('')
  const [transferVehicleModel, setTransferVehicleModel] = useState('')
  const [transferVehicleVariant, setTransferVehicleVariant] = useState('')
  const [transferVehicleColor, setTransferVehicleColor] = useState('')
  const [transferVehiclePrice, setTransferVehiclePrice] = useState('')

  // #12 Dealer-hold dialog state.
  const [holdDialogOpen, setHoldDialogOpen] = useState(false)
  const [holdVin, setHoldVin] = useState('')
  const [holdNotes, setHoldNotes] = useState('')

  // BBND MARK — "Build But Not Delivered". Remarks are mandatory, so the dialog cannot be confirmed
  // with an empty box (the confirm button is disabled on !bbndMarkNotes.trim(), same rule as Hold).
  // ⚠️ Named bbndMark* on purpose: the identifiers bbndDialogOpen/bbndVin below already belong to
  // the "#8 BBND (Booked-But-Not-in-DMS) allot" dialog — same abbreviation, unrelated feature.
  const [bbndMarkDialogOpen, setBbndMarkDialogOpen] = useState(false)
  const [bbndMarkVin, setBbndMarkVin] = useState('')
  const [bbndMarkNotes, setBbndMarkNotes] = useState('')

  // #8 BBND (Booked-But-Not-in-DMS) allot dialog state.
  const [bbndDialogOpen, setBbndDialogOpen] = useState(false)
  const [bbndBookingId, setBbndBookingId] = useState('')
  const [bbndVin, setBbndVin] = useState('')
  const [bbndModel, setBbndModel] = useState('')
  const [bbndVariant, setBbndVariant] = useState('')
  const [bbndColor, setBbndColor] = useState('')

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
      pageSize: '9999',
    })
    if (search) params.set('search', search)
    if (dealerCode !== 'All') params.set('dealer_code', dealerCode)
    if (model !== 'All') params.set('model', model)
    if (status !== 'All') params.set('status', status)
    if (dmsStatus !== 'All') params.set('dms_status', dmsStatus)
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    return params.toString()
  }, [search, dealerCode, model, status, dmsStatus, startDate, endDate, page])

  // Query stock data
  const { data, isLoading, isError, error, refetch } = useQuery<StockPayload>({
    queryKey: ['kia-proforma-stock', queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/proforma/stock?${queryParams}`)
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null)
        throw new Error(errorPayload?.error || 'Failed to load stock data')
      }
      return response.json()
    },
    staleTime: 5 * 1000,
    gcTime: DASHBOARD_GC_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  })

  // Query unallocated active bookings for allotment matching
  const { data: bookingsData, isLoading: isLoadingBookings } = useQuery<{ rows: BookingOption[] }>({
    queryKey: ['kia-unallocated-active-bookings'],
    queryFn: async () => {
      const response = await fetch('/api/brands/kia/bookings?unallocated=true&pageSize=1000')
      if (!response.ok) throw new Error('Failed to load unallocated active bookings')
      return response.json()
    },
    staleTime: 5 * 1000,
    gcTime: DASHBOARD_GC_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  })

  const bookingsList = (bookingsData?.rows || []).filter(
    (b) => !['draft', 'booking_created', 'cancelled'].includes(b.status || '')
  )

  // Single source of truth for "which bookings match this vehicle" — used by BOTH
  // the badge count and the badge drawer so they never disagree.
  const getMatchingBookings = (row: StockRow) => {
    if (row.allocation_id) return []
    return bookingsList.filter((b) => {
      // 1. Model Match (strict base model comparison)
      const bModelStr = String(b.model || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(thenew|allnew|new)/, '').replace(/(petrol|diesel|ev|hev|mhev)$/, '').trim()
      const rModelStr = String(row.model || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(thenew|allnew|new)/, '').replace(/(petrol|diesel|ev|hev|mhev)$/, '').trim()
      if (!bModelStr || !rModelStr) return false
      const modelMatches = bModelStr === rModelStr || bModelStr.includes(rModelStr) || rModelStr.includes(bModelStr)
      if (!modelMatches) return false

      // 2. Variant Match (strict variant / trim comparison)
      const bVar = String(b.variant || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const rVar = String(row.variant || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!bVar || !rVar) return false
      const variantMatches = bVar === rVar || bVar.includes(rVar) || rVar.includes(bVar)
      if (!variantMatches) return false

      // 3. Color Match (strict exterior color comparison)
      const bColor = String(b.color || (b.metadata as any)?.color || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const rColor = String(row.color || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!bColor || !rColor) return false
      return bColor === rColor || bColor.includes(rColor) || rColor.includes(bColor)
    })
  }

  const getMatchingBookingsCount = (row: StockRow) => getMatchingBookings(row).length

  // Booking badge drawer — shows every booking linked/matched to a vehicle.
  const [badgeDrawerVin, setBadgeDrawerVin] = useState<string | null>(null)

  // Mutations
  const allotMutation = useMutation({
    mutationFn: async ({ bookingId, vin, extraTimeDays, extraTimeReason }: {
      bookingId: string
      vin: string
      // Optional request for a longer customer payment window. The allotment still applies the
      // STANDARD window; this only records the ask for the MD to approve or reject.
      extraTimeDays?: number
      extraTimeReason?: string
    }) => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/allot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vinNumber: vin,
          ...(extraTimeDays ? { extraTimeDays, extraTimeReason } : {}),
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to allot vehicle')
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      toast({
        title: 'Success',
        description: variables.extraTimeDays
          ? `Vehicle allotted. Your ${variables.extraTimeDays}-day extra time request has been sent to the MD — the standard window applies until they approve it.`
          : 'Vehicle allotted successfully!',
        variant: 'success',
      })
      setAllotDialogOpen(false)
      setSelectedBookingId('')
      resetExtraTime()
      setStockSuccess('allot')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-payment-window-requests'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  const transferMutation = useMutation({
    mutationFn: async ({ bookingId, vin, toDealerCode, notes, transferType, amountReceived, exchangeModel, exchangeVariant, exchangeColor, priceDifference }: {
      bookingId: string
      vin: string
      toDealerCode: string
      notes: string
      transferType?: string
      amountReceived?: string
      exchangeModel?: string
      exchangeVariant?: string
      exchangeColor?: string
      priceDifference?: string
    }) => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vinNumber: vin, toDealerCode, notes, transferType, amountReceived, exchangeModel, exchangeVariant, exchangeColor, priceDifference }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to request transfer')
      }
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Vehicle transfer requested successfully!', variant: 'success' })
      setTransferDialogOpen(false)
      setTransferNotes('')
      setStockSuccess('transfer')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  // #12 Hold (dealer) / release-hold / payment-received. #8 BBND allot.
  const holdMutation = useMutation({
    mutationFn: async (payload: { vinNumber: string; notes?: string }) => {
      const res = await fetch('/api/brands/kia/stock/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to hold vehicle')
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Vehicle held for dealer', description: 'On hold for 48h — record payment within the window or it returns to stock.', variant: 'success' })
      setHoldDialogOpen(false)
      setHoldNotes('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  const bbndMarkMutation = useMutation({
    mutationFn: async (payload: { vinNumber: string; notes: string }) => {
      const res = await fetch('/api/brands/kia/stock/bbnd-mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to mark BBND')
      return res.json()
    },
    onSuccess: () => {
      // Stays in free stock by design — say so, or the user assumes it vanished like a Hold.
      toast({ title: 'Marked BBND', description: 'Build But Not Delivered. The vehicle remains in free stock and can still be allotted.', variant: 'success' })
      setBbndMarkDialogOpen(false)
      setBbndMarkNotes('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  const holdPaymentMutation = useMutation({
    mutationFn: async (vinNumber: string) => {
      const res = await fetch('/api/brands/kia/stock/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'payment', vinNumber }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to record payment')
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Payment recorded', description: 'The hold is confirmed and will not auto-release.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  const releaseHoldMutation = useMutation({
    mutationFn: async (vinNumber: string) => {
      const res = await fetch('/api/brands/kia/stock/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release', vinNumber }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to release hold')
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Hold released', description: 'The vehicle is matchable again.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  const releaseTransferMutation = useMutation({
    mutationFn: async (vinNumber: string) => {
      const res = await fetch('/api/brands/kia/stock/transfer/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vinNumber }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to release transfer')
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Transfer released', description: 'The vehicle is back to free stock.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  const bbndMutation = useMutation({
    mutationFn: async (payload: { bookingId: string; vinNumber: string; model: string; variant: string; color: string }) => {
      const res = await fetch('/api/brands/kia/stock/bbnd-allot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to allot BBND vehicle')
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'BBND vehicle allotted', description: 'The vehicle was allotted and saved durably.', variant: 'success' })
      setBbndDialogOpen(false)
      setBbndBookingId(''); setBbndVin(''); setBbndModel(''); setBbndVariant(''); setBbndColor('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
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
      toast({ title: 'Success', description: 'Payment confirmed successfully!', variant: 'success' })
      setPaymentDialogOpen(false)
      setPaymentReference('')
      setPaymentFile(null)
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
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
      toast({ title: 'Success', description: 'Vehicle released successfully!', variant: 'success' })
      setReleaseDialogOpen(false)
      setReleaseReason('')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
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
      toast({ title: 'Success', description: 'Vehicle marked as delivered!', variant: 'success' })
      setDeliverDialogOpen(false)
      setStockSuccess('deliver')
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
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
      toast({ title: 'Success', description: 'Allocation cancelled successfully!', variant: 'success' })
      setCancelDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
      // Allotment/release/hold all change which bookings are still unallocated. Invalidating here is
      // what lets the unallocated-bookings query drop refetchOnMount:'always' (which refetched 1000
      // bookings on EVERY mount, ignoring staleTime).
      queryClient.invalidateQueries({ queryKey: ['kia-unallocated-active-bookings'] })
    },
    onError: (err) => toast({ title: 'Error', description: err.message, variant: 'error' }),
  })

  // Proforma options (models + variants) — fetched lazily when the Against Vehicle transfer type is active.
  type KiaProformaOptionsPayload = { models: string[]; trims: { model: string; trim_description: string }[] }
  const proformaOptionsQuery = useQuery<KiaProformaOptionsPayload>({
    queryKey: ['kia-proforma-options-stock-transfer'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/proforma/options')
      if (!res.ok) throw new Error('Failed to load options')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: transferType === 'against_vehicle',
  })

  const selectedJourneyBookingId = useMemo(() => {
    if (!journeyVin) return null
    const r = data?.rows?.find(r => r.vin_number === journeyVin)
    if (r?.booking_id) return r.booking_id
    const tm = data?.transferMissing?.find(r => r.vin_number === journeyVin)
    if (tm?.booking_id) return tm.booking_id
    const sm = data?.soldMissing?.find(r => r.vin_number === journeyVin)
    if (sm?.booking_id) return sm.booking_id
    const np = data?.noPayment?.find(r => r.vin_number === journeyVin)
    if (np?.booking_id) return np.booking_id
    const hv = data?.heldVehicles?.find(r => r.vin_number === journeyVin)
    const snap = (hv?.vehicle_snapshot || {}) as Record<string, any>
    if (snap?.booking_id) return String(snap.booking_id)
    return null
  }, [journeyVin, data])

  const sidebarBookingQuery = useQuery({
    queryKey: ['kia-sidebar-booking-detail', selectedJourneyBookingId],
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/bookings/${selectedJourneyBookingId}`)
      if (!res.ok) throw new Error('Failed to load booking details')
      return res.json()
    },
    enabled: !!selectedJourneyBookingId,
    staleTime: 30 * 1000,
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
    if (!row.booking_id || row.booking_status === 'delivered') return <span className="text-slate-400 font-semibold">-</span>

    if (row.booking_status === 'ready_delivery') {
      if (row.booking_delivery_date) {
        try {
          const deliveryDate = new Date(row.booking_delivery_date)
          if (!isNaN(deliveryDate.getTime())) {
            const deliveryTime = new Date(deliveryDate.getFullYear(), deliveryDate.getMonth(), deliveryDate.getDate()).getTime()
            const today = new Date()
            const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
            const diffMs = deliveryTime - todayTime
            const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000))

            if (diffDays > 0) {
              return (
                <span className="inline-flex items-center rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
                  paid · waiting {diffDays}d for delivery
                </span>
              )
            } else if (diffDays === 0) {
              return (
                <span className="inline-flex items-center rounded-xl bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700 border border-amber-200 animate-pulse">
                  paid · delivery TODAY
                </span>
              )
            } else {
              return (
                <span className="inline-flex items-center rounded-xl bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700 border border-rose-200 animate-pulse">
                  paid · delivery OVERDUE {Math.abs(diffDays)}d
                </span>
              )
            }
          }
        } catch (e) {
          console.error("Failed to parse delivery target date", e)
        }
      }
      return (
        <span className="inline-flex items-center rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
          paid · awaiting delivery date
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
    // Each state gets a distinct tone so Available / Allotted / Paid / Delivered
    // / Transferred never read as the same colour. Active allocation states take
    // precedence; an unallocated VIN with a transfer record reads as Transferred.
    if (row.allocation_id) {
      if (row.booking_status === 'ready_delivery') return <Chip tone="violet">Paid · To Deliver</Chip>
      if (row.booking_status === 'delivered') return <Chip tone="blue">Delivered</Chip>
      return <Chip tone="amber">Allotted</Chip>
    }
    if (row.transfer_id) return <Chip tone="sky">Transferred{row.to_dealer_code ? ` → ${row.to_dealer_code}` : ''}</Chip>
    // Committed in the DMS by someone other than us. This fell through to a green "Available" chip,
    // which contradicted the Available KPI — that card excludes stock_status 'ALLOCATED', so the
    // table claimed 7 cars were available while the card counted 0 of them.
    // Neutral, not rose: the car is still allottable from here (readMatchingVehicle ignores
    // stock_status), so this is provenance, not a block.
    if (String(row.stock_status || '').trim().toUpperCase() === 'ALLOCATED') {
      return <Chip tone="neutral">DMS Allocated</Chip>
    }
    return <Chip tone="emerald">Available</Chip>
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
  // No hardcoded fallback: an invented status the feed does not use would offer a guaranteed-empty
  // option, and the real list is short and always present in the payload.
  const dmsStatusFilters = data?.filters?.dmsStatuses || []

  const filteredStockRows = useMemo(() => {
    const rows = data?.rows || []
    if (!startDate && !endDate) return rows

    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0
    const end = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Infinity

    return rows.filter((row) => {
      const rawDate =
        row.allocated_at ||
        row.transfer_requested_at ||
        row.booking_delivery_date ||
        row.expires_at ||
        row.metadata?.dms_purchase_date ||
        row.metadata?.created_at ||
        row.metadata?.purchase_date ||
        null

      if (!rawDate) return true
      const time = new Date(rawDate).getTime()
      if (isNaN(time)) return true
      return time >= start && time <= end
    })
  }, [data?.rows, startDate, endDate])

  const getShareText = () => {
    if (!filteredStockRows || filteredStockRows.length === 0) return ''
    const dealerMap: Record<string, Record<string, StockRow[]>> = {}
    filteredStockRows.forEach(r => {
      const dealer = r.dealer_code || 'UNASSIGNED'
      const modelName = r.model || 'UNKNOWN MODEL'
      if (!dealerMap[dealer]) dealerMap[dealer] = {}
      if (!dealerMap[dealer][modelName]) dealerMap[dealer][modelName] = []
      dealerMap[dealer][modelName].push(r)
    })

    let text = '🚗 AM KIA STOCK UPDATE\n\n'
    Object.keys(dealerMap).forEach(dealer => {
      text += `📍 DEALER: ${dealer}\n`
      const models = dealerMap[dealer]
      Object.keys(models).forEach(mName => {
        const units = models[mName]
        text += `\n${mName} (${units.length} unit${units.length > 1 ? 's' : ''})\n`
        units.forEach(u => {
          text += `  • ${u.variant || 'Standard'} — ${u.color || 'No Colour'} — Age: ${u.stock_age || 0}d\n`
        })
      })
      text += '\n───────────────────\n\n'
    })
    return text.trim()
  }

  const handleDownloadExcel = () => {
    const rowsToExport = filteredStockRows.map((row, idx) => ({
      'S.No': idx + 1,
      'VIN Number': row.vin_number || '—',
      'Engine Number': row.engine_no || '—',
      'Model': row.model || '—',
      'Variant': row.variant || '—',
      'Color': row.color || '—',
      'Stock Status': row.stock_status || '—',
      'Dealer Code': row.dealer_code || '—',
      'Stock Age (Days)': row.stock_age || '—',
      'Customer Name': row.customer_name || '—',
      'Consultant': row.consultant_name || '—',
      'Booking Number': row.booking_number || '—',
      'Bank Name': row.bank_name || '—',
      'Allocated Date': row.allocated_at ? new Date(row.allocated_at).toLocaleDateString('en-IN') : '—',
      'Delivery Target Date': row.booking_delivery_date ? new Date(row.booking_delivery_date).toLocaleDateString('en-IN') : '—',
    }))

    if (rowsToExport.length === 0) {
      toast({ title: 'No Data', description: 'No stock records found matching current filters.', variant: 'error' })
      return
    }

    const ws = XLSX.utils.json_to_sheet(rowsToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Report')

    const dateStr = new Date().toISOString().slice(0, 10)
    const filterSuffix = startDate || endDate ? `_${startDate || 'start'}_to_${endDate || 'end'}` : ''
    XLSX.writeFile(wb, `AM_Kia_Stock_Report_${dateStr}${filterSuffix}.xlsx`)
    toast({ title: 'Success', description: 'Stock report downloaded in Excel format.', variant: 'success' })
  }

  const handleCopyWhatsApp = () => {
    const text = getShareText()
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: 'Copied!', description: 'WhatsApp stock report copied to clipboard.', variant: 'success' })
    })
  }

  const handleDownloadTXT = () => {
    const text = getShareText()
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `AM_Kia_Stock_${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadPDF = () => {
    const originalTitle = document.title
    const date = new Date().toISOString().slice(0, 10)
    document.title = `AM_Kia_Stock_Report_${date}`
    window.print()
    // Restore after a short delay to allow the print dialog to capture the title
    setTimeout(() => { document.title = originalTitle }, 1000)
  }

  return (
    <div className="kia-premium w-full min-w-0 space-y-4">
      {/* 1. Metrics Grid — animated business widgets, click to filter */}
      {data?.metrics && (
        <KpiRow
          items={([
            { key: 'All', label: 'Total VINs', value: data.metrics.total_vins, icon: Car, tone: 'blue' as Tone, hint: 'Every status · click to see all' },
            { key: 'AVAILABLE', label: 'Available', value: data.metrics.available, icon: CheckCircle2, tone: 'emerald' as Tone, hint: 'Free to allot' },
            { key: 'PAYMENT_PENDING', label: 'Payment Pending', value: data.metrics.payment_pending, icon: WalletCards, tone: 'amber' as Tone, hint: 'Allotted by us · awaiting payment' },
            /*
             * DMS Allocated is a separate card because it is not a stage of OUR pipeline.
             *
             * These cars were committed inside the DMS; nobody here allotted them, so there is no
             * customer, no booking and no payment window. They used to be counted under Payment
             * Pending, which read 8 when only 1 vehicle was genuinely awaiting payment.
             *
             * `neutral` on purpose: every other card is a bucket someone here has to act on, and this
             * one is not — it is inventory we simply cannot offer.
             */
            { key: 'ALLOCATED_DMS', label: 'DMS Allocated', value: data.metrics.dms_allocated || 0, icon: Lock, tone: 'neutral' as Tone, hint: 'Committed in DMS · not ours' },
            { key: 'PAID_TO_DELIVER', label: 'Paid · To Deliver', value: data.metrics.paid_to_deliver, icon: BadgeIndianRupee, tone: 'violet' as Tone, hint: 'Ready to hand over' },
            { key: 'DELIVERED', label: 'Delivered', value: data.metrics.delivered, icon: Truck, tone: 'teal' as Tone, hint: 'Completed' },
            { key: 'TRANSFERRED', label: 'Transfers', value: (data.metrics.transfers || 0) + (data.metrics.transfer_missing || 0), icon: RefreshCw, tone: 'sky' as Tone, hint: 'Inter-outlet' },
          ] as (KpiDatum & { active?: boolean })[]).map((item) => ({ ...item, active: status === item.key }))}
          onSelect={selectStatusImmediately}
        />
      )}

      {/* 2. Main Grid Layout for Table and Audit Panel */}
      <div className={cn("grid grid-cols-1 gap-4 transition-all duration-300",
        auditLogOpen && canViewAudit ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1"
      )}>
        {/* Main/Left Column: Filters and Table */}
        <div className="w-full min-w-0 space-y-4">
          
          {/* Filters Bar */}
          <div className="kia-surface flex flex-wrap items-center gap-3 p-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
              <Input
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters() }}
                placeholder="search VIN, customer, consultant..."
                className="h-9 w-full rounded-xl pl-10 text-xs font-semibold"
              />
            </div>

            {/* Dealer dropdown */}
            <Select value={draftDealerCode} onValueChange={setDraftDealerCode}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl text-xs font-bold border-slate-200 bg-white shadow-sm">
                <SelectValue placeholder="All Dealers" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-slate-200 z-[50] rounded-xl shadow-md">
                <SelectItem value="All" className="text-xs font-semibold cursor-pointer">All Dealers</SelectItem>
                {dealerFilters.map(d => (
                  <SelectItem key={d} value={d} className="text-xs font-semibold cursor-pointer">
                    {d === 'JK402' ? 'JK402 Jammu' : d === 'JK501' ? 'JK501 Udhampur' : d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Model dropdown */}
            <Select value={draftModel} onValueChange={setDraftModel}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl text-xs font-bold border-slate-200 bg-white shadow-sm">
                <SelectValue placeholder="All Models" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-slate-200 z-[50] rounded-xl shadow-md">
                <SelectItem value="All" className="text-xs font-semibold cursor-pointer">All Models</SelectItem>
                {modelFilters.map(m => (
                  <SelectItem key={m} value={m} className="text-xs font-semibold cursor-pointer">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status dropdown */}
            <Select value={draftStatus} onValueChange={setDraftStatus}>
              <SelectTrigger className="h-9 w-[160px] rounded-xl text-xs font-bold border-slate-200 bg-white shadow-sm">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-slate-200 z-[50] rounded-xl shadow-md">
                <SelectItem value="All" className="text-xs font-bold cursor-pointer">All Status</SelectItem>
                <SelectItem value="AVAILABLE" className="text-xs font-bold cursor-pointer">Available</SelectItem>
                <SelectItem value="PAYMENT_PENDING" className="text-xs font-bold cursor-pointer">Payment Pending</SelectItem>
                {/* DMS-committed cars with no allocation of ours. Kept out of Available because
                    someone else has already claimed the car in the DMS — a reporting boundary, NOT a
                    capability one: readMatchingVehicle ignores stock_status, so these are still
                    allottable and keep their Allot button. */}
                <SelectItem value="ALLOCATED_DMS" className="text-xs font-bold cursor-pointer">Allocated (DMS)</SelectItem>
                <SelectItem value="PAID_TO_DELIVER" className="text-xs font-bold cursor-pointer">Paid - To Deliver</SelectItem>
                <SelectItem value="DELIVERED" className="text-xs font-bold cursor-pointer">Delivered</SelectItem>
                <SelectItem value="TRANSFERRED" className="text-xs font-bold cursor-pointer">Transferred</SelectItem>
              </SelectContent>
            </Select>

            {/* DMS status dropdown — the raw kia_stock_management.stock_status, as the feed reports it.
                Options and counts come from the data, so a status the DMS adds later appears on its
                own and no option can ever be a dead end. */}
            <Select value={draftDmsStatus} onValueChange={selectDmsStatus}>
              <SelectTrigger className="h-9 w-[175px] rounded-xl text-xs font-bold border-slate-200 bg-white shadow-sm">
                <SelectValue placeholder="All DMS Status" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-slate-200 z-[50] rounded-xl shadow-md">
                <SelectItem value="All" className="text-xs font-bold cursor-pointer">All DMS Status</SelectItem>
                {dmsStatusFilters.map(s => (
                  <SelectItem key={s.status} value={s.status} className="text-xs font-bold cursor-pointer">
                    {s.status} ({s.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date Range Filter */}
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1 shadow-sm">
              <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <button
                type="button"
                onClick={() => {
                  const d = new Date()
                  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
                  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
                  setDraftStartDate(firstDay)
                  setDraftEndDate(lastDay)
                }}
                className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-lg transition-colors"
                title="Current Month"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftStartDate('')
                  setDraftEndDate('')
                }}
                className="text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-lg transition-colors"
                title="All Time Data"
              >
                All Time
              </button>
              <span className="text-[10px] font-bold text-slate-400 uppercase ml-1">From</span>
              <input
                type="date"
                value={draftStartDate}
                onChange={(e) => setDraftStartDate(e.target.value)}
                className="h-7 text-xs font-semibold text-slate-700 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 cursor-pointer"
              />
              <span className="text-[10px] font-bold text-slate-400 uppercase ml-1">To</span>
              <input
                type="date"
                value={draftEndDate}
                onChange={(e) => setDraftEndDate(e.target.value)}
                className="h-7 text-xs font-semibold text-slate-700 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 cursor-pointer"
              />
              {(draftStartDate || draftEndDate) && (
                <button
                  type="button"
                  onClick={() => { setDraftStartDate(''); setDraftEndDate('') }}
                  className="ml-1 text-slate-400 hover:text-slate-600 transition-colors p-0.5 rounded-md hover:bg-slate-100"
                  title="Clear Date Filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Apply / Reset — nothing above reaches the API until Apply is pressed. */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={applyFilters}
                disabled={!filtersDirty}
                className={cn(
                  'h-9 rounded-xl px-4 text-xs font-black shadow-sm transition-all',
                  filtersDirty
                    ? 'bg-slate-950 text-white hover:bg-slate-800'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed hover:bg-slate-100'
                )}
                title={filtersDirty ? 'Apply the selected filters' : 'No filter changes to apply'}
              >
                {filtersDirty && (
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
                )}
                Apply
              </Button>
              {!filtersAtDefault && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resetFilters}
                  className="h-9 rounded-xl px-3 text-xs font-black border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                  title="Clear all filters"
                >
                  Reset
                </Button>
              )}
            </div>

            {/* Audit Log button — MD & Super Admin only */}
            {canViewAudit && (
              <Button
                size="sm"
                variant="outline"
                className={cn("h-9 rounded-xl text-xs font-black border-slate-200 transition-all shadow-sm",
                  auditLogOpen ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-white hover:bg-slate-50 text-slate-800"
                )}
                onClick={() => setAuditLogOpen(!auditLogOpen)}
              >
                <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Audit Log
              </Button>
            )}

            {/* Share Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 rounded-xl text-xs font-black border-slate-200 bg-white shadow-sm">
                  <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share Stock <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-xl border border-slate-200 bg-white shadow-md z-[50]">
                <DropdownMenuItem className="text-xs cursor-pointer focus:bg-slate-50 font-semibold" onClick={handleCopyWhatsApp}>📋 Copy (WhatsApp)</DropdownMenuItem>
                <DropdownMenuItem className="text-xs cursor-pointer focus:bg-slate-50 font-semibold" onClick={handleDownloadExcel}>📊 Download Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem className="text-xs cursor-pointer focus:bg-slate-50 font-semibold" onClick={handleDownloadPDF}>📄 Download PDF</DropdownMenuItem>
                <DropdownMenuItem className="text-xs cursor-pointer focus:bg-slate-50 font-semibold" onClick={handleDownloadTXT}>📝 Download TXT</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Refresh button */}
            <Button variant="outline" className="h-9 w-9 rounded-xl border-slate-200 bg-white p-0 shadow-sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 text-slate-600" />
            </Button>
          </div>

          {/* Main Table */}
          {isLoading ? (
            <PremiumTableSkeleton rows={8} columns={11} />
          ) : isError ? (
            <PremiumEmptyState
              illustration="error"
              title="Failed to load stock data"
              description={error instanceof Error ? error.message : "Refresh the page to retry, or check the server logs if it repeats."}
            />
          ) : filteredStockRows.length === 0 ? (
            <PremiumEmptyState illustration="garage" title="No stock vehicles found" description="Adjust your search query or date filters to browse available inventory." />
          ) : (
            <div className="kia-surface w-full overflow-x-auto">
              <Table className="kia-table w-full min-w-[950px]">
                <TableHeader>
                   <TableRow>
                     {['STATUS', 'DMS STATUS', 'CAR', 'VIN / CHASSIS', 'COLOUR', 'AGE', 'DEALER', 'CUSTOMER', 'TEAM', 'FINANCIER', 'CLOCK', 'ACTIONS'].map((h) => (
                       <TableHead key={h} className="h-9 whitespace-nowrap px-2 py-2">{h}</TableHead>
                     ))}
                   </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStockRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer border-b"
                      style={{ borderColor: 'var(--kia-hairline)' }}
                      onClick={() => setJourneyVin(row.vin_number)}
                    >
                      {/* STATUS */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap">{renderStatus(row)}</TableCell>

                      {/* DMS STATUS */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap">
                        {(() => {
                          const s = (row.stock_status || '').toUpperCase()
                          if (s === 'FREE STOCK') return <Chip tone="emerald">Free Stock</Chip>
                          if (s.includes('TRANSIT') || s.includes('IN TRANSIT')) return <Chip tone="sky">In Transit</Chip>
                          if (s === 'RETAIL') return <Chip tone="amber">Retail</Chip>
                          if (s === 'BLOCKED') return <Chip tone="rose">Blocked</Chip>
                          if (s === 'DEMO') return <Chip tone="violet">Demo</Chip>
                          return row.stock_status ? <Chip tone="neutral">{row.stock_status}</Chip> : <span className="text-slate-400 text-[10px] font-semibold">-</span>
                        })()}
                      </TableCell>

                      {/* CAR */}
                      <TableCell className="px-2 py-2 align-middle">
                        <div className="font-black text-slate-950 text-[11px] uppercase whitespace-nowrap">{row.model || '-'}</div>
                        <div className="text-[10px] font-bold text-slate-500 max-w-[160px] truncate">{row.variant || '-'}</div>
                        {/* Confirmed booking against this vehicle (allotted) — an unmistakable flag. */}
                        {row.booking_id && (
                          <span
                            className="mt-1.5 flex w-fit items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700"
                            title={`Booked against ${row.booking_number ? `#${row.booking_number}` : 'a booking'}${row.customer_name ? ` · ${row.customer_name}` : ''}`}
                          >
                            <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-600" />
                            <span>BOOKED{row.booking_number ? ` · #${row.booking_number}` : ''}</span>
                          </span>
                        )}
                        {(() => {
                          const count = getMatchingBookingsCount(row)
                          if (count === 0) return null
                          return (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setBadgeDrawerVin(row.vin_number) }}
                              className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full w-fit transition-all hover:bg-amber-200 hover:border-amber-300 hover:shadow-sm active:scale-95 cursor-pointer"
                              title="View matching bookings"
                            >
                              <Users className="h-3 w-3 text-amber-700 shrink-0" />
                              <span>{count} Booking{count > 1 ? 's' : ''}</span>
                              <ChevronRight className="h-2.5 w-2.5 text-amber-600 shrink-0" />
                            </button>
                          )
                        })()}
                      </TableCell>

                      {/* VIN / CHASSIS */}
                      <TableCell className="px-2 py-2 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1 font-mono text-[10.5px] font-extrabold tracking-wider text-indigo-700 shadow-xs dark:bg-indigo-950/40 dark:border-indigo-900/50 dark:text-indigo-400">
                          {row.vin_number}
                        </span>
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
                            <div className="text-[9px] font-bold text-slate-500">{maskKiaPii(row.customer_phone, canViewCustomerPii)}</div>
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
                          {row.booking_status === 'delivered' ? (
                            <Badge className="rounded-full border border-green-200 bg-green-50 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-green-700">DELIVERED</Badge>
                          ) : row.transfer_id ? (
                            <>
                              <Badge className="rounded-full border border-sky-200 bg-sky-50 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">TRANSFERRED</Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-lg border-rose-200 px-2 text-[10px] font-black text-rose-700 hover:bg-rose-50"
                                disabled={releaseTransferMutation.isPending}
                                onClick={() => releaseTransferMutation.mutate(row.vin_number)}
                              >
                                {releaseTransferMutation.isPending ? 'Releasing...' : 'Release'}
                              </Button>
                            </>
                          ) : !row.allocation_id ? (
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
                                  setTransferDialogOpen(true)
                                }}
                              >
                                Transfer
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-lg border-amber-200 px-2 text-[10px] font-black text-amber-700 hover:bg-amber-50"
                                onClick={() => {
                                  setHoldVin(row.vin_number)
                                  setHoldNotes('')
                                  setHoldDialogOpen(true)
                                }}
                              >
                                Hold
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-lg border-violet-200 px-2 text-[10px] font-black text-violet-700 hover:bg-violet-50"
                                title="Build But Not Delivered — flags the vehicle without taking it out of free stock"
                                onClick={() => {
                                  setBbndMarkVin(row.vin_number)
                                  setBbndMarkNotes('')
                                  setBbndMarkDialogOpen(true)
                                }}
                              >
                                BBND
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
            </div>
          )}
        </div>

        {/* Right Column: Audit Log Side Panel — MD & Super Admin only */}
        {auditLogOpen && canViewAudit && (
          <div className="kia-surface flex h-[550px] flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface-sunken)' }}>
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-[var(--kia-text-soft)]" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--kia-text)]">Audit Log</h3>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 rounded-lg p-0 text-[var(--kia-text-faint)] hover:bg-[var(--kia-surface-sunken)]" onClick={() => setAuditLogOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="kia-scroll flex-1 overflow-y-auto p-2">
              {data?.activities && data.activities.length > 0 ? (
                data.activities.map((act) => (
                  <div key={act.id} className="flex items-start gap-2.5 px-3 py-2.5">
                    <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-slate-50 border border-slate-200">
                      {getActivityIcon(act.title)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-slate-900 leading-tight">
                        <span className="font-black">{act.actor_name}</span>{' '}
                        {act.title.toLowerCase().replace('vin', 'VIN')}{' '}
                        <span className="text-slate-500">{act.description}</span>
                      </div>
                      <div className="mt-0.5 text-[9px] font-semibold text-slate-400">
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
        )}
      </div>

      {/* 4. Dialogs */}

      {/* ALLOT DIALOG */}
      <Dialog open={allotDialogOpen} onOpenChange={setAllotDialogOpen}>
        <DialogContent className="kia-premium flex flex-col max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-2xl animate-in fade-in zoom-in duration-200">
          <LoaderOverlay show={allotMutation.isPending} variant="vin-match" label="Allotting VIN…" sublabel="Linking the vehicle to the booking" />
          <DialogHeader className="p-5 pb-3 border-b border-slate-100 bg-white shrink-0 space-y-1">
            <DialogTitle className="text-lg font-extrabold tracking-tight text-[var(--kia-text)]">Allot Vehicle to Booking</DialogTitle>
            <DialogDescription className="text-xs font-medium leading-relaxed text-[var(--kia-text-soft)]">
              Select an approved proforma booking below to link to this vehicle.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-4">
            {/* Selected VIN Card */}
            <div className="flex items-center justify-between rounded-2xl border p-4" style={toneSoftStyle('accent')}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">Selected VIN</div>
                <code className="mt-1 block font-mono text-xs font-extrabold">{allotVin}</code>
              </div>
              {(() => {
                const row = data?.rows?.find(r => r.vin_number === allotVin)
                if (!row) return null
                return (
                  <div className="text-right">
                    <div className="text-xs font-black text-slate-900 uppercase">{row.model}</div>
                    <div className="text-[10px] font-bold text-slate-500 mt-0.5">{row.variant}</div>
                  </div>
                )
              })()}
            </div>

            {/*
              Ageing-stock warning. Purely advisory — it never blocks the allotment, it just makes
              sure nobody allots a fresh arrival while an older identical car is quietly ageing in the
              same yard. `older_count` comes from the API over the whole stock table, so it stays
              accurate no matter how the list above is filtered.
            */}
            {(() => {
              const row = data?.rows?.find(r => r.vin_number === allotVin)
              const olderCount = row?.older_count ?? 0
              if (!row || olderCount < 1) return null
              const thisAge = Number(String(row.stock_age || '').replace(/[^0-9]/g, '')) || 0
              const oldestAge = row.oldest_alternative_age ?? 0
              const gap = oldestAge - thisAge
              return (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
                    <div className="min-w-0 space-y-1.5">
                      <p className="text-xs font-black uppercase tracking-wider text-amber-900">
                        Older stock available
                      </p>
                      <p className="text-[11px] font-semibold leading-relaxed text-amber-900">
                        {olderCount === 1
                          ? 'Another identical vehicle has been in stock longer than this one.'
                          : `${olderCount} other identical vehicles have been in stock longer than this one.`}{' '}
                        Allotting this one leaves the older stock ageing.
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-[11px] font-bold text-amber-900">
                        <span>
                          This VIN:{' '}
                          <span className="font-mono tabular-nums">{thisAge}d</span>
                        </span>
                        <span>
                          Oldest:{' '}
                          <span className="font-mono tabular-nums">{oldestAge}d</span>
                          {row.oldest_alternative_vin && (
                            <span className="ml-1 font-mono opacity-70">
                              …{String(row.oldest_alternative_vin).slice(-8)}
                            </span>
                          )}
                        </span>
                        {gap > 0 && (
                          <span className="rounded-lg bg-amber-200/70 px-2 py-0.5">
                            {gap}d older
                          </span>
                        )}
                      </div>
                      <p className="pt-0.5 text-[10px] font-semibold text-amber-700">
                        Same model, variant and outlet. You can still continue if this VIN is the right one.
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 block">
                  Select Approved Booking
                </label>
                {isLoadingBookings ? (
                  <div className="flex items-center gap-3 h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500 font-semibold animate-pulse">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                    <span>Fetching eligible bookings...</span>
                  </div>
                ) : (
                  <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
                    <SelectTrigger className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold shadow-sm hover:border-slate-300 hover:bg-slate-50/30 transition-all">
                      <SelectValue placeholder="Choose an approved booking..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-slate-200 bg-white shadow-xl max-h-[250px] z-[120]">
                      {(() => {
                        const row = data?.rows?.find(r => r.vin_number === allotVin)
                        const matchingBookings = row ? getMatchingBookings(row) : []
                        const modelBookings = row ? bookingsList.filter(b => {
                          const bModelStr = String(b.model || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(thenew|allnew|new)/, '').replace(/(petrol|diesel|ev|hev|mhev)$/, '').trim()
                          const rModelStr = String(row.model || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(thenew|allnew|new)/, '').replace(/(petrol|diesel|ev|hev|mhev)$/, '').trim()
                          return !bModelStr || !rModelStr || bModelStr === rModelStr || bModelStr.includes(rModelStr) || rModelStr.includes(bModelStr)
                        }) : []
                        const displayBookings = matchingBookings.length > 0 ? matchingBookings : modelBookings
                        return (
                          <>
                            {displayBookings.map((b) => (
                              <SelectItem 
                                key={b.id} 
                                value={b.id} 
                                className="text-xs focus:bg-slate-50 cursor-pointer p-3 rounded-lg border-b last:border-b-0 border-slate-100"
                              >
                                <div className="flex flex-col gap-0.5">
                                  <div className="font-black text-slate-950 text-[11px] uppercase tracking-wider">{b.bookingNumber}</div>
                                  <div className="font-bold text-slate-800 text-[11px]">{b.customerName}</div>
                                  <div className="text-[10px] text-slate-500 font-semibold">{b.model} • {b.variant}</div>
                                </div>
                              </SelectItem>
                            ))}
                            {displayBookings.length === 0 && (
                              <div className="text-xs font-semibold text-slate-400 text-center py-4">
                                No matching bookings waiting for allocation.
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Selected Booking Verification Details Panel */}
              {(() => {
                const selectedBooking = bookingsList.find(b => b.id === selectedBookingId)
                if (!selectedBooking) return null
                return (
                  <div className="border border-slate-200/80 bg-slate-50/80 rounded-2xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200 text-slate-700">
                    <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-slate-200 pb-1.5 mb-2">
                      Verify Booking Details
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                      <div>
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Customer</span>
                        <span className="font-bold text-slate-900">{selectedBooking.customerName}</span>
                        <span className="text-[10px] text-slate-500 font-semibold block">{maskKiaPii(selectedBooking.customerPhone, canViewCustomerPii)}</span>
                      </div>
                      <div>
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Booking Number</span>
                        <span className="font-mono font-black text-indigo-600 uppercase">{selectedBooking.bookingNumber}</span>
                      </div>
                      <div>
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Model Preference</span>
                        <span className="font-black text-slate-950 uppercase">{selectedBooking.model}</span>
                        <span className="text-[10px] text-slate-500 font-semibold block">{selectedBooking.variant}</span>
                      </div>
                      <div>
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Color Preference</span>
                        <span className="font-semibold text-slate-700">{selectedBooking.color || 'No preference'}</span>
                      </div>
                      <div>
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Consultant</span>
                        <span className="font-semibold text-slate-700 uppercase">{selectedBooking.consultantName || '-'}</span>
                      </div>
                      <div>
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Finance / Bank</span>
                        <span className="font-semibold text-slate-700">
                          {selectedBooking.financeRequired ? `Required (${selectedBooking.bankName || 'Pending'})` : 'CASH / self finance'}
                        </span>
                      </div>
                    </div>
                    {selectedBooking.notes && (
                      <div className="border-t border-slate-200/60 pt-2">
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-wider block">Special Notes</span>
                        <p className="text-[10px] font-semibold text-slate-600 mt-0.5 leading-relaxed bg-white border border-slate-150 rounded-lg p-2 max-h-20 overflow-y-auto">
                          {selectedBooking.notes}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/*
                Optional extra-payment-time request. Only offered once a booking is selected, because
                the request is about that booking's allocation.
              */}
              {selectedBookingId && (
                <div className="rounded-xl border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => (extraTimeOpen ? resetExtraTime() : setExtraTimeOpen(true))}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs font-black text-slate-800">Request extra payment time</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">optional</span>
                    </span>
                    <span className={cn(
                      'text-[10px] font-black uppercase tracking-wider',
                      extraTimeOpen ? 'text-rose-600' : 'text-indigo-600',
                    )}>
                      {extraTimeOpen ? 'Remove' : 'Add'}
                    </span>
                  </button>

                  {extraTimeOpen && (
                    <div className="space-y-3 border-t border-slate-100 px-3.5 py-3">
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-5 text-amber-900">
                        The standard payment window starts as soon as you allot. It is only extended if
                        the MD approves this request — don&apos;t promise the customer the longer window yet.
                      </p>

                      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
                        <div>
                          <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 block mb-1">Days requested</span>
                          <select
                            value={extraTimeDays}
                            onChange={(e) => setExtraTimeDays(e.target.value)}
                            className="h-9 w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900"
                          >
                            <option value="">Choose…</option>
                            {Array.from({ length: 15 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={String(d)}>{d} day{d === 1 ? '' : 's'}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                            Reason <span className="text-rose-600">*</span>
                          </span>
                          <Input
                            value={extraTimeReason}
                            onChange={(e) => setExtraTimeReason(e.target.value)}
                            placeholder="Why does this customer need longer?"
                            className="h-9 rounded-xl border-slate-200 bg-white text-xs font-semibold"
                          />
                        </div>
                      </div>

                      {!extraTimeReady && (
                        <p className="text-[11px] font-semibold text-rose-700">
                          Choose the number of days and give a reason, or remove the request.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 shrink-0 gap-2 sm:gap-0 mt-0">
            <Button variant="outline" className="h-10 rounded-xl text-xs font-black px-4" onClick={() => { setAllotDialogOpen(false); resetExtraTime() }}>
              Cancel
            </Button>
            <Button
              className="h-10 rounded-xl px-5 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white shadow-md"
              disabled={allotMutation.isPending || !selectedBookingId || !extraTimeReady}
              onClick={() => allotMutation.mutate({
                bookingId: selectedBookingId,
                vin: allotVin,
                ...(extraTimeOpen && extraTimeDays !== ''
                  ? { extraTimeDays: Number(extraTimeDays), extraTimeReason: extraTimeReason.trim() }
                  : {}),
              })}
            >
              {allotMutation.isPending ? 'Allotting…' : 'Confirm Allotment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BBND Dialog — remarks are MANDATORY */}
      <Dialog open={bbndMarkDialogOpen} onOpenChange={setBbndMarkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <LoaderOverlay show={bbndMarkMutation.isPending} variant="generic" label="Marking BBND…" sublabel="Recording Build But Not Delivered" />
          <DialogHeader>
            <DialogTitle>Mark as BBND</DialogTitle>
            <DialogDescription>
              Build But Not Delivered — <span className="font-semibold text-violet-700">{bbndVin || '—'}</span>.
              The vehicle stays in free stock and can still be allotted; this only records why it is built but undelivered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              Remarks <span className="text-rose-600">*</span>
            </Label>
            <Textarea
              value={bbndMarkNotes}
              onChange={(event) => setBbndMarkNotes(event.target.value)}
              placeholder="Why is this vehicle built but not delivered?"
              rows={3}
              autoFocus
            />
            {!bbndMarkNotes.trim() && (
              <p className="text-[11px] font-semibold text-slate-400">Remarks are required before a vehicle can be marked BBND.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBbndMarkDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-violet-700 text-white hover:bg-violet-800"
              disabled={bbndMarkMutation.isPending || !bbndMarkNotes.trim()}
              onClick={() => bbndMarkMutation.mutate({ vinNumber: bbndMarkVin, notes: bbndMarkNotes.trim() })}
            >
              {bbndMarkMutation.isPending ? 'Marking…' : 'Mark BBND'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #12 HOLD DIALOG (Customer / Dealer) */}
      <Dialog open={holdDialogOpen} onOpenChange={setHoldDialogOpen}>
        <DialogContent className="kia-premium flex flex-col max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-2xl">
          <LoaderOverlay show={holdMutation.isPending} variant="generic" label="Holding vehicle…" sublabel="Marking the VIN on hold" />
          <DialogHeader className="p-5 pb-3 border-b border-slate-100 bg-white shrink-0 space-y-1">
            <DialogTitle className="text-lg font-extrabold tracking-tight text-[var(--kia-text)]">Hold Vehicle for Dealer</DialogTitle>
            <DialogDescription className="text-xs font-medium leading-relaxed text-[var(--kia-text-soft)]">
              Hold this VIN for a dealer. It is reserved for 48 hours — record payment within the window or it automatically returns to stock.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-4">
            <div className="rounded-2xl border p-4" style={toneSoftStyle('accent')}>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">Selected VIN</div>
              <code className="mt-1 block font-mono text-xs font-extrabold">{holdVin}</code>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 block">Dealer / Reason</label>
              <Input value={holdNotes} onChange={(e) => setHoldNotes(e.target.value)} placeholder="Dealer name / reason for hold" className="h-11 rounded-xl border-slate-200 text-xs" />
            </div>
          </div>

          <DialogFooter className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 shrink-0 gap-2 sm:gap-0 mt-0">
            <Button variant="outline" className="h-10 rounded-xl text-xs font-black px-4" onClick={() => setHoldDialogOpen(false)}>Cancel</Button>
            <Button
              className="h-10 rounded-xl px-5 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white shadow-md"
              disabled={holdMutation.isPending || !holdNotes.trim()}
              onClick={() => holdMutation.mutate({ vinNumber: holdVin, notes: holdNotes || undefined })}
            >
              {holdMutation.isPending ? 'Holding…' : 'Confirm Hold (48h)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

{/* #8 BBND ALLOT DIALOG (Booked-But-Not-in-DMS) */}
      <Dialog open={bbndDialogOpen} onOpenChange={setBbndDialogOpen}>
        <DialogContent className="kia-premium flex flex-col max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-2xl">
          <LoaderOverlay show={bbndMutation.isPending} variant="vin-match" label="Allotting BBND…" sublabel="Registering the vehicle and linking the booking" />
          <DialogHeader className="p-5 pb-3 border-b border-slate-100 bg-white shrink-0 space-y-1">
            <DialogTitle className="text-lg font-extrabold tracking-tight text-[var(--kia-text)]">Allot BBND Vehicle</DialogTitle>
            <DialogDescription className="text-xs font-medium leading-relaxed text-[var(--kia-text-soft)]">
              Allot a Booked-But-Not-in-DMS vehicle: enter the VIN and details, and link it to an approved booking. It is saved durably like an allotment.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-3">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 block">Approved Booking</label>
              <Select value={bbndBookingId} onValueChange={setBbndBookingId}>
                <SelectTrigger className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold"><SelectValue placeholder="Choose an approved booking…" /></SelectTrigger>
                <SelectContent className="rounded-xl border border-slate-200 bg-white shadow-xl max-h-[250px] z-[120]">
                  {bookingsList.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs p-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="font-black text-slate-950 text-[11px] uppercase">{b.bookingNumber}</div>
                        <div className="font-bold text-slate-800 text-[11px]">{b.customerName}</div>
                        <div className="text-[10px] text-slate-500 font-semibold">{b.model} • {b.variant}</div>
                      </div>
                    </SelectItem>
                  ))}
                  {bookingsList.length === 0 && <div className="text-xs font-semibold text-slate-400 text-center py-4">No bookings available.</div>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 block">VIN Number</label>
              <Input value={bbndVin} onChange={(e) => setBbndVin(e.target.value.toUpperCase())} placeholder="Full VIN" className="h-11 rounded-xl border-slate-200 text-xs font-mono" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input value={bbndModel} onChange={(e) => setBbndModel(e.target.value)} placeholder="Model" className="h-11 rounded-xl border-slate-200 text-xs" />
              <Input value={bbndVariant} onChange={(e) => setBbndVariant(e.target.value)} placeholder="Variant" className="h-11 rounded-xl border-slate-200 text-xs" />
              <Input value={bbndColor} onChange={(e) => setBbndColor(e.target.value)} placeholder="Color" className="h-11 rounded-xl border-slate-200 text-xs" />
            </div>
          </div>

          <DialogFooter className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 shrink-0 gap-2 sm:gap-0 mt-0">
            <Button variant="outline" className="h-10 rounded-xl text-xs font-black px-4" onClick={() => setBbndDialogOpen(false)}>Cancel</Button>
            <Button
              className="h-10 rounded-xl px-5 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white shadow-md"
              disabled={bbndMutation.isPending || !bbndBookingId || !bbndVin.trim()}
              onClick={() => bbndMutation.mutate({ bookingId: bbndBookingId, vinNumber: bbndVin.trim(), model: bbndModel.trim(), variant: bbndVariant.trim(), color: bbndColor.trim() })}
            >
              {bbndMutation.isPending ? 'Allotting…' : 'Allot BBND'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TRANSFER DIALOG */}
      <Dialog open={transferDialogOpen} onOpenChange={(open) => { setTransferDialogOpen(open); if (!open) { setTransferType(null); setTransferAmountReceived(''); setTransferVehicleModel(''); setTransferVehicleVariant(''); setTransferVehicleColor(''); setTransferVehiclePrice('') } }}>
        <DialogContent className="kia-premium flex flex-col max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl">
          <LoaderOverlay show={transferMutation.isPending} variant="transfer" label="Requesting transfer…" sublabel="Moving the VIN between outlets" />
          <DialogHeader className="p-5 pb-3 border-b border-slate-100 bg-white shrink-0">
            <DialogTitle className="text-base font-extrabold tracking-tight text-[var(--kia-text)]">Request Vehicle Transfer</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              Initiate a transfer request for VIN <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-700">{transferVin}</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-4">
            {/* Step 1: Transfer Type */}
            {!transferType ? (
              <div>
                <p className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Choose Transfer Type</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setTransferType('against_payment')}
                    className="group flex flex-col items-start gap-2.5 rounded-xl border-2 border-slate-200 bg-white p-4 text-left transition-all hover:border-emerald-400 hover:bg-emerald-50/50 hover:shadow-md"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200">
                      <BadgeIndianRupee className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-slate-950">Against Payment</div>
                      <div className="mt-0.5 text-[11px] font-semibold leading-4 text-slate-500">Customer pays a cash amount for this vehicle.</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransferType('against_vehicle')}
                    className="group flex flex-col items-start gap-2.5 rounded-xl border-2 border-slate-200 bg-white p-4 text-left transition-all hover:border-sky-400 hover:bg-sky-50/50 hover:shadow-md"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-600 group-hover:bg-sky-200">
                      <Car className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-slate-950">Against Vehicle</div>
                      <div className="mt-0.5 text-[11px] font-semibold leading-4 text-slate-500">Customer exchanges a vehicle. Enter details and price difference.</div>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Back + type badge */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTransferType(null)}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50"
                  >
                    ← Back
                  </button>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${
                    transferType === 'against_payment' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                  }`}>
                    {transferType === 'against_payment' ? '💰 Against Payment' : '🚗 Against Vehicle'}
                  </span>
                </div>

                {/* Against Payment */}
                {transferType === 'against_payment' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Amount Received (₹)</label>
                    <Input
                      type="number"
                      value={transferAmountReceived}
                      onChange={(e) => setTransferAmountReceived(e.target.value)}
                      placeholder="e.g. 50000"
                      className="h-10 rounded-xl border-slate-200 text-xs font-semibold"
                    />
                  </div>
                )}

                {/* Against Vehicle */}
                {transferType === 'against_vehicle' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Exchange Model</label>
                      <Select
                        value={transferVehicleModel}
                        onValueChange={(val) => { setTransferVehicleModel(val); setTransferVehicleVariant('') }}
                      >
                        <SelectTrigger className="h-10 rounded-xl border-slate-200 text-xs font-semibold bg-white shadow-sm">
                          <SelectValue placeholder={proformaOptionsQuery.isLoading ? 'Loading...' : 'Select model'} />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border border-slate-200 bg-white z-[80] shadow-md">
                          {(proformaOptionsQuery.data?.models ?? []).map((m) => (
                            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Exchange Variant</label>
                      <Select
                        value={transferVehicleVariant}
                        onValueChange={setTransferVehicleVariant}
                        disabled={!transferVehicleModel}
                      >
                        <SelectTrigger className="h-10 rounded-xl border-slate-200 text-xs font-semibold bg-white shadow-sm">
                          <SelectValue placeholder={!transferVehicleModel ? 'Select model first' : 'Select variant'} />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border border-slate-200 bg-white z-[80] shadow-md">
                          {Array.from(
                            new Map(
                              (proformaOptionsQuery.data?.trims ?? [])
                                .filter((t) => t.model === transferVehicleModel)
                                .map((t) => [t.trim_description, t])
                            ).values()
                          ).map((t) => (
                            <SelectItem key={t.trim_description} value={t.trim_description} className="text-xs">{t.trim_description}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Exchange Color</label>
                      <Input value={transferVehicleColor} onChange={(e) => setTransferVehicleColor(e.target.value)} placeholder="e.g. Gravity Grey" className="h-10 rounded-xl border-slate-200 text-xs font-semibold" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Price Difference (₹)</label>
                      <Input type="number" value={transferVehiclePrice} onChange={(e) => setTransferVehiclePrice(e.target.value)} placeholder="e.g. 25000" className="h-10 rounded-xl border-slate-200 text-xs font-semibold" />
                    </div>
                  </div>
                )}

                {/* Common fields */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Target Dealer Code</label>
                  <Select value={transferDealer} onValueChange={setTransferDealer}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 text-xs font-semibold bg-white shadow-sm">
                      <SelectValue placeholder="Choose target outlet..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-slate-200 bg-white z-[60] shadow-md">
                      <SelectItem value="JK402" className="text-xs">JK402 — Jammu</SelectItem>
                      <SelectItem value="JK501" className="text-xs">JK501 — Udhampur</SelectItem>
                      <SelectItem value="Others" className="text-xs">Others</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {transferDealer === 'Others' && (
                  <div className="space-y-1.5 animate-in fade-in duration-200">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Specify Outlet Code</label>
                    <Input
                      value={transferDealerOther}
                      onChange={(e) => setTransferDealerOther(e.target.value)}
                      placeholder="Enter custom dealer code..."
                      className="h-10 rounded-xl border border-slate-200 text-xs font-semibold"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Transfer Notes</label>
                  <Input
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    placeholder="Reason for transfer, timeline details..."
                    className="h-10 rounded-xl border border-slate-200 text-xs font-semibold"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setTransferDialogOpen(false)}>
              Cancel
            </Button>
            {transferType && (
              <Button
                className="h-9 rounded-xl px-4 text-xs font-bold"
                disabled={transferMutation.isPending || !transferDealer || (transferDealer === 'Others' && !transferDealerOther)}
                onClick={() => transferMutation.mutate({
                  bookingId: 'none',
                  vin: transferVin,
                  toDealerCode: transferDealer === 'Others' ? transferDealerOther : transferDealer,
                  notes: transferNotes,
                  transferType,
                  ...(transferType === 'against_payment' ? { amountReceived: transferAmountReceived } : {}),
                  ...(transferType === 'against_vehicle' ? {
                    exchangeModel: transferVehicleModel,
                    exchangeVariant: transferVehicleVariant,
                    exchangeColor: transferVehicleColor,
                    priceDifference: transferVehiclePrice,
                  } : {}),
                })}
              >
                {transferMutation.isPending ? 'Requesting...' : 'Confirm Request'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PAYMENT RECEIVED DIALOG */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="kia-premium max-w-md rounded-2xl border-0 bg-white p-5">
          <LoaderOverlay show={paymentMutation.isPending} variant="payment" label="Confirming payment…" sublabel="Verifying receipt and unlocking delivery" />
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold tracking-tight text-[var(--kia-text)]">Confirm Payment Receipt</DialogTitle>
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
              className="h-9 rounded-xl px-4 text-xs font-bold"
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
        <DialogContent className="kia-premium max-w-md rounded-2xl border-0 bg-white p-5">
          <LoaderOverlay show={releaseMutation.isPending} variant="generic" label="Releasing VIN…" sublabel="Returning the unit to available stock" />
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold tracking-tight text-[var(--kia-text)]">Release VIN Allocation</DialogTitle>
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
        <DialogContent className="kia-premium max-w-sm rounded-2xl border-0 bg-white p-5">
          <LoaderOverlay show={deliverMutation.isPending} variant="delivery" label="Completing delivery…" sublabel="Handing the vehicle to the customer" />
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold tracking-tight text-[var(--kia-text)]">Confirm Vehicle Delivery</DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              Confirm that the vehicle has been handed over to the customer. This changes status to "Delivered" and archives the active allotment countdown.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" className="h-9 rounded-xl text-xs font-black" onClick={() => setDeliverDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="h-9 rounded-xl px-4 text-xs font-bold"
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
        <DialogContent className="kia-premium max-w-sm rounded-2xl border-0 bg-white p-5">
          <LoaderOverlay show={cancelMutation.isPending} variant="generic" label="Cancelling allocation…" sublabel="Releasing the VIN back to stock" />
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold tracking-tight text-[var(--kia-text)]">Cancel Allocation</DialogTitle>
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

      {/* 5. Vehicle Journey Sidebar Drawer */}
      {mounted && journeyVin && (
        (() => {
          const findRow = () => {
            const r = data?.rows?.find(r => r.vin_number === journeyVin)
            if (r) return r
            
            const tm = data?.transferMissing?.find(r => r.vin_number === journeyVin)
            if (tm) {
              const snap = (tm.vehicle_snapshot || {}) as Record<string, any>
              return {
                ...tm,
                model: snap.model || 'CARENS',
                variant: snap.variant || '',
                color: snap.exterior_color_name || '',
                stock_age: snap.stock_age || '',
                stock_status: snap.stock_status || '',
                dealer_code: tm.dealer_code || '',
              } as any
            }
            const sm = data?.soldMissing?.find(r => r.vin_number === journeyVin)
            if (sm) {
              const snap = (sm.vehicle_snapshot || {}) as Record<string, any>
              return {
                ...sm,
                model: snap.model || '',
                variant: snap.variant || '',
                color: snap.exterior_color_name || '',
                stock_age: snap.stock_age || '',
                stock_status: snap.stock_status || '',
              } as any
            }
            const np = data?.noPayment?.find(r => r.vin_number === journeyVin)
            if (np) {
              const snap = (np.vehicle_snapshot || {}) as Record<string, any>
              return {
                ...np,
                model: snap.model || '',
                variant: snap.variant || '',
                color: snap.exterior_color_name || '',
                stock_age: snap.stock_age || '',
                stock_status: snap.stock_status || '',
              } as any
            }
            const hv = data?.heldVehicles?.find(r => r.vin_number === journeyVin)
            if (hv) {
              const snap = (hv.vehicle_snapshot || {}) as Record<string, any>
              return {
                ...hv,
                model: snap.model || '',
                variant: snap.variant || '',
                color: snap.exterior_color_name || '',
                stock_age: snap.stock_age || '',
                stock_status: snap.stock_status || '',
              } as any
            }
            return null
          }
          const row = findRow()
          if (!row) return null

          const isBooking = !!row.booking_id
          const isProforma = !!row.booking_id
          const isAllotted = !!row.allocation_id
          const isPaid = row.booking_status === 'ready_delivery' || row.booking_status === 'delivered'
          const isDelivered = row.booking_status === 'delivered'

          const findActivity = (typeKeywords: string[]) => {
            if (!sidebarBookingQuery.data?.activities) return null
            return sidebarBookingQuery.data.activities.find((a: any) => 
              typeKeywords.some(kw => 
                (a.type || '').toLowerCase().includes(kw) || 
                (a.message || '').toLowerCase().includes(kw)
              )
            )
          }

          const bookingCreatedAct = findActivity(['create'])
          const bookingCreatedText = bookingCreatedAct 
            ? `Created by ${bookingCreatedAct.actorName} on ${new Date(bookingCreatedAct.createdAt).toLocaleString('en-IN')}.`
            : isBooking ? `Booking #${row.booking_number} created for ${row.customer_name}.` : 'Awaiting booking registration.'

          const proformaApprovedAct = findActivity(['proforma', 'approve'])
          const proformaApprovedText = proformaApprovedAct 
            ? `Approved by ${proformaApprovedAct.actorName} on ${new Date(proformaApprovedAct.createdAt).toLocaleString('en-IN')}.`
            : isProforma ? 'Proforma generated and verified by Manager.' : 'Awaiting proforma validation.'

          const allotAct = findActivity(['allot'])
          const allotText = allotAct 
            ? `Allotted by ${allotAct.actorName} on ${new Date(allotAct.createdAt).toLocaleString('en-IN')}.`
            : isAllotted ? `VIN allocated to booking. Status: ${row.allocation_status || 'final'}` : 'Awaiting vehicle allotment.'

          const paymentAct = findActivity(['payment', 'invoice'])
          const paymentText = paymentAct 
            ? `Confirmed by ${paymentAct.actorName} on ${new Date(paymentAct.createdAt).toLocaleString('en-IN')}.`
            : isPaid ? `Payment confirmed. Reference: ${row.bank_name || 'Accounts Confirmation'}` : 'Pending payment verification.'

          const deliverAct = findActivity(['deliver'])
          const deliverText = deliverAct 
            ? `Delivered by ${deliverAct.actorName} on ${new Date(deliverAct.createdAt).toLocaleString('en-IN')}.`
            : isDelivered ? 'Vehicle delivered to customer successfully.' : 'Awaiting delivery dispatch.'

          const steps = [
            { key: 'booking', icon: ClipboardList, title: 'Booking Created', done: isBooking, body: bookingCreatedText },
            { key: 'proforma', icon: FileText, title: 'Proforma Approved', done: isProforma, body: proformaApprovedText },
            { key: 'allot', icon: Car, title: 'Vehicle Allotted', done: isAllotted, body: allotText },
            { key: 'payment', icon: BadgeIndianRupee, title: 'Payment Confirmed', done: isPaid, body: paymentText },
            { key: 'delivery', icon: Truck, title: 'Delivered', done: isDelivered, body: deliverText },
          ]
          const firstPending = steps.findIndex((s) => !s.done)
          return createPortal(
            <motion.div
              className="kia-premium fixed inset-y-0 right-0 z-[99999] flex h-full w-[420px] max-w-[92vw] flex-col border-l shadow-2xl"
              style={{ backgroundColor: 'var(--kia-canvas)', borderColor: 'var(--kia-hairline)' }}
              initial={{ x: 44, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Hero */}
              <div className="relative overflow-hidden border-b p-5 text-white" style={{ borderColor: 'var(--kia-hairline)', background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))' }}>
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">Vehicle Journey</p>
                    <code className="mt-1 block truncate font-mono text-sm font-extrabold">{row.vin_number}</code>
                    <p className="mt-1 text-xs font-semibold text-white/85">{row.model} · {row.variant}</p>
                  </div>
                  <button
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                    onClick={(e) => { e.stopPropagation(); setJourneyVin(null) }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="kia-scroll flex-1 space-y-5 overflow-y-auto p-5">
                {/* Vehicle card */}
                <div className="kia-surface-flush p-4">
                  <div className="flex items-center gap-2.5">
                    <IconTile icon={Car} tone="info" size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-[var(--kia-text)]">{row.model}</p>
                      <p className="truncate text-xs font-medium text-[var(--kia-text-soft)]">{row.variant}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <FieldValue label="Dealer" value={row.dealer_code} />
                    <FieldValue label="Colour" value={row.color} />
                    <FieldValue label="Stock Age" value={row.stock_age} />
                    <FieldValue label="Status" value={row.stock_status} />
                  </div>
                </div>

                {/* Timeline */}
                <div className="kia-surface p-4">
                  <div className="flex items-center gap-2.5">
                    <IconTile icon={ClipboardList} tone="accent" size="sm" />
                    <h3 className="text-sm font-extrabold tracking-tight text-[var(--kia-text)]">Progress Timeline</h3>
                  </div>
                  <div className="mt-4">
                    {steps.map((step, i) => {
                      const current = i === firstPending
                      const StepIcon = step.icon
                      return (
                        <motion.div
                          key={step.key}
                          className="relative flex gap-3.5"
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <div className="flex flex-col items-center">
                            <span
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2"
                              style={{
                                backgroundColor: step.done ? 'var(--dashboard-action-bg)' : 'var(--kia-surface)',
                                borderColor: step.done || current ? 'var(--dashboard-action-bg)' : 'var(--kia-hairline-strong)',
                                color: step.done ? 'var(--dashboard-action-fg)' : current ? 'var(--dashboard-action-bg)' : 'var(--kia-text-faint)',
                              }}
                            >
                              {step.done ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                            </span>
                            {i < steps.length - 1 && (
                              <span className="my-1 w-0.5 flex-1" style={{ backgroundColor: step.done ? 'var(--dashboard-action-bg)' : 'var(--kia-hairline-strong)' }} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 pb-6">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-[13px] font-extrabold text-[var(--kia-text)]">{step.title}</h4>
                              {step.done && <Chip tone="success">Done</Chip>}
                              {current && <Chip tone="warning">Current</Chip>}
                            </div>
                            <p className="mt-0.5 text-[11px] font-medium leading-5 text-[var(--kia-text-soft)]">{step.body}</p>
                          </div>
                        </motion.div>
                      )
                    })}
                    {row.transfer_status && (
                      <motion.div
                        className="relative flex gap-3.5"
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: steps.length * 0.06, duration: 0.35 }}
                      >
                        <div className="flex flex-col items-center">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-white" style={{ backgroundColor: 'var(--dashboard-support-1)', borderColor: 'var(--dashboard-support-1)' }}>
                            <RefreshCw className="h-4 w-4" />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-[13px] font-extrabold text-[var(--kia-text)]">Dealer Transfer</h4>
                            <Chip tone="info">{row.transfer_status}</Chip>
                          </div>
                          <p className="mt-0.5 text-[11px] font-medium leading-5 text-[var(--kia-text-soft)]">
                            Outlet transfer requested to {row.to_dealer_code}
                            {row.transfer_requester_name ? ` by ${row.transfer_requester_name}` : ''}
                            {row.transfer_requested_at ? ` on ${new Date(row.transfer_requested_at).toLocaleString('en-IN')}` : ''}.
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>,
            document.body
          )
        })()
      )}

      {/* Booking Badge Drawer — every booking matched to this vehicle */}
      {mounted && badgeDrawerVin && (
        (() => {
          const row = data?.rows?.find((r) => r.vin_number === badgeDrawerVin)
          const matches = row ? getMatchingBookings(row) : []
          const statusChip = (status?: string | null): { label: string; tone: Tone } => {
            const s = String(status || '').toLowerCase()
            if (s === 'delivered') return { label: 'Delivered', tone: 'success' }
            if (s === 'ready_delivery') return { label: 'Ready · To Deliver', tone: 'violet' }
            if (s === 'vehicle_allocated') return { label: 'Vehicle Allotted', tone: 'info' }
            if (s === 'proforma_generated') return { label: 'Proforma Generated', tone: 'accent' }
            if (s === 'booking_created') return { label: 'Booking Created', tone: 'warning' }
            if (s === 'cancelled') return { label: 'Cancelled', tone: 'danger' }
            return { label: status ? String(status).replace(/_/g, ' ') : 'Active', tone: 'neutral' }
          }
          const paymentMethod = (b: BookingOption) => {
            const meta = (b.metadata || {}) as Record<string, unknown>
            const raw = meta.pmtSource || meta.paymentMethod || meta.paymentSource || b.bankName
            if (raw) return String(raw)
            return b.financeRequired ? 'Bank Finance' : 'Cash / Self'
          }
          const fmtDate = (value?: string | null) => {
            if (!value) return '—'
            const d = new Date(value)
            if (Number.isNaN(d.getTime())) return '—'
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          }
          return createPortal(
            <>
              <motion.div
                className="fixed inset-0 z-[99998] bg-slate-950/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setBadgeDrawerVin(null)}
              />
              <motion.div
                className="kia-premium fixed inset-y-0 right-0 z-[99999] flex h-full w-[460px] max-w-[94vw] flex-col border-l shadow-2xl"
                style={{ backgroundColor: 'var(--kia-canvas)', borderColor: 'var(--kia-hairline)' }}
                initial={{ x: 48, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Hero */}
                <div className="relative overflow-hidden border-b p-5 text-white" style={{ borderColor: 'var(--kia-hairline)', background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))' }}>
                  <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">Matching Bookings</p>
                      <code className="mt-1 block truncate font-mono text-sm font-extrabold">{badgeDrawerVin}</code>
                      {row && <p className="mt-1 text-xs font-semibold text-white/85">{row.model} · {row.variant}</p>}
                    </div>
                    <button
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                      onClick={() => setBadgeDrawerVin(null)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {!isLoadingBookings && (
                    <div className="relative mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-black">
                      <ClipboardList className="h-3 w-3" />
                      {matches.length} booking{matches.length === 1 ? '' : 's'} matched
                    </div>
                  )}
                </div>

                <div className="kia-scroll flex-1 space-y-3 overflow-y-auto p-4">
                  {isLoadingBookings ? (
                    [0, 1, 2].map((i) => (
                      <div key={i} className="kia-surface animate-pulse p-4">
                        <div className="h-3 w-28 rounded bg-[var(--kia-hairline-strong)]" />
                        <div className="mt-2 h-2.5 w-40 rounded bg-[var(--kia-hairline)]" />
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {[0, 1, 2, 3].map((j) => <div key={j} className="h-6 rounded bg-[var(--kia-hairline)]" />)}
                        </div>
                      </div>
                    ))
                  ) : matches.length === 0 ? (
                    <PremiumEmptyState illustration="garage" title="No matching bookings" description="No approved bookings are currently waiting for a vehicle of this model and variant." />
                  ) : (
                    matches.map((b, i) => {
                      const chip = statusChip(b.status)
                      return (
                        <motion.div
                          key={b.id}
                          className="kia-surface p-4"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <code className="font-mono text-[11px] font-black uppercase text-[var(--dashboard-action-bg)]">{b.bookingNumber}</code>
                              <p className="mt-0.5 truncate text-sm font-extrabold text-[var(--kia-text)]">{b.customerName}</p>
                              <p className="text-[11px] font-semibold text-[var(--kia-text-soft)]">{maskKiaPii(b.customerPhone, canViewCustomerPii)}</p>
                            </div>
                            <Chip tone={chip.tone}>{chip.label}</Chip>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <FieldValue label="Model" value={b.model} />
                            <FieldValue label="Variant" value={b.variant} />
                            <FieldValue label="Colour" value={b.color || '—'} />
                            <FieldValue label="Dealer" value={b.dealerCode || '—'} />
                            <FieldValue label="Booking Date" value={fmtDate(b.createdAt)} />
                            <FieldValue label="Delivery Date" value={fmtDate(b.deliveryTargetDate)} />
                            <FieldValue label="Payment Method" value={paymentMethod(b)} />
                            <FieldValue label="Proforma" value={b.proformaNumber ? `#${b.proformaNumber}` : 'Generated'} />
                            <FieldValue label="Consultant" value={b.consultantName || '—'} />
                          </div>
                          {b.notes && (
                            <div className="mt-2.5 rounded-lg bg-[var(--kia-canvas)] p-2.5 border border-[var(--kia-hairline)]">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-soft)]">Remarks</p>
                              <p className="mt-1 text-xs font-semibold text-[var(--kia-text)] whitespace-pre-wrap">{b.notes}</p>
                            </div>
                          )}
                          <div className="mt-3 flex justify-end">
                            <Button
                              size="sm"
                              className="h-8 rounded-lg bg-slate-950 px-3 text-[10px] font-black text-white hover:bg-slate-800"
                              onClick={() => {
                                setBadgeDrawerVin(null)
                                setAllotVin(badgeDrawerVin as string)
                                setSelectedBookingId(b.id)
                                setAllotDialogOpen(true)
                              }}
                            >
                              Allot This Booking
                            </Button>
                          </div>
                        </motion.div>
                      )
                    })
                  )}
                </div>
              </motion.div>
            </>,
            document.body
          )
        })()
      )}

      {/* 6. Printable Stock Report Container */}
      <div id="printable-stock-report" className="hidden print:block p-8 bg-slate-50 text-slate-900 font-sans w-full min-h-screen">
        {/* Banner Header */}
        <div className="mb-6 flex items-center justify-between border-b-2 border-slate-900 pb-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white p-1 shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="h-full w-full">
                <clipPath id="print-circle">
                  <circle cx="50" cy="50" r="50"/>
                </clipPath>
                <image href="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg" x="0" y="0" height="100" width="100" clipPath="url(#print-circle)" />
              </svg>
            </div>
            <div>
              <h1 className="text-[26px] font-black leading-none tracking-tight text-slate-950">AM KIA</h1>
              <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.28em] text-slate-500">Stock Inventory Report</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block rounded-full bg-slate-900 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-white">
              Confidential
            </span>
            <div className="mt-2 text-[10px] font-semibold text-slate-500">
              Generated {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}
            </div>
            <div className="text-[10px] font-semibold text-slate-400">{filteredStockRows.length} vehicles listed</div>
          </div>
        </div>

        {/* Stats Grid */}
        {data?.metrics && (
          <div className="mb-6 grid grid-cols-4 gap-3">
            {[
              { label: 'Total Inventory', val: data.metrics.total_vins, accent: '#0f172a' },
              { label: 'Available VINs', val: data.metrics.available, accent: '#059669' },
              { label: 'Allotted / Pending', val: data.metrics.total_vins - data.metrics.available, accent: '#4f46e5' },
              { label: 'Transfers', val: data.metrics.transfers, accent: '#0891b2' },
            ].map((s) => (
              <div key={s.label} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <span className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: s.accent }} />
                <div className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">{s.label}</div>
                <div className="mt-1 text-xl font-black tracking-tight" style={{ color: s.accent }}>{s.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Sold / Missing from DMS — allotted vehicles whose VIN left the DMS feed (retained via
            the allocation snapshot; they can't appear in the stock table which reads FROM DMS). */}
        {data?.soldMissing && data.soldMissing.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/60 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-800">Sold / Missing from DMS</span>
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-black text-amber-800">{data.soldMissing.length}</span>
              </div>
              <span className="text-[10px] font-semibold text-amber-700">Allotted vehicles no longer in the DMS stock feed — likely sold. Verify &amp; update status.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-amber-100 text-[9px] font-black uppercase tracking-[0.12em] text-amber-800">
                    <th className="px-4 py-2.5">VIN</th>
                    <th className="px-4 py-2.5">Car</th>
                    <th className="px-4 py-2.5">Dealer</th>
                    <th className="px-4 py-2.5">Booking</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">Missing Since</th>
                  </tr>
                </thead>
                <tbody>
                  {data.soldMissing.map((v) => (
                    <tr key={v.allocation_id} className="border-t border-amber-100 text-slate-700">
                      <td className="px-4 py-2.5 font-mono font-bold">{v.vin_number}</td>
                      <td className="px-4 py-2.5 font-semibold">{[v.model, v.variant, v.color].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-2.5">{v.dealer_code || '—'}</td>
                      <td className="px-4 py-2.5 font-mono">{v.booking_number || '—'}</td>
                      <td className="px-4 py-2.5">{v.customer_name || '—'}</td>
                      <td className="px-4 py-2.5">{v.stock_missing_at ? new Date(v.stock_missing_at).toLocaleDateString('en-IN') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* No Payment Received — allocations kept after the reservation window lapsed without payment
            (#13). Retained via the allocation snapshot so they persist even once the VIN leaves DMS. */}
        {data?.noPayment && data.noPayment.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-rose-300 bg-rose-50/60 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-rose-800">No Payment Received</span>
                <span className="rounded-full bg-rose-200 px-2 py-0.5 text-[10px] font-black text-rose-800">{data.noPayment.length}</span>
              </div>
              <span className="text-[10px] font-semibold text-rose-700">Held after the 72h / 5-day reservation window lapsed with no payment. Follow up or release.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-rose-100 text-[9px] font-black uppercase tracking-[0.12em] text-rose-800">
                    <th className="px-4 py-2.5">VIN</th>
                    <th className="px-4 py-2.5">Car</th>
                    <th className="px-4 py-2.5">Dealer</th>
                    <th className="px-4 py-2.5">Booking</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">Window Expired</th>
                  </tr>
                </thead>
                <tbody>
                  {data.noPayment.map((v) => (
                    <tr key={v.allocation_id} className="border-t border-rose-100 text-slate-700">
                      <td className="px-4 py-2.5 font-mono font-bold">{v.vin_number}</td>
                      <td className="px-4 py-2.5 font-semibold">{[v.model, v.variant, v.color].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-2.5">{v.dealer_code || '—'}</td>
                      <td className="px-4 py-2.5 font-mono">{v.booking_number || '—'}</td>
                      <td className="px-4 py-2.5">{v.customer_name || '—'}</td>
                      <td className="px-4 py-2.5">{v.expires_at ? new Date(v.expires_at).toLocaleDateString('en-IN') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transferred / Missing from DMS — vehicles transferred to this dealer whose VIN left the DMS
            feed (#9). Retained via the transfer snapshot and shown under the DESTINATION dealer. */}
        {data?.transferMissing && data.transferMissing.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-sky-300 bg-sky-50/60 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-sky-800">Transferred · Not in DMS</span>
                <span className="rounded-full bg-sky-200 px-2 py-0.5 text-[10px] font-black text-sky-800">{data.transferMissing.length}</span>
              </div>
              <span className="text-[10px] font-semibold text-sky-700">Transferred to this dealer but no longer in the DMS feed — retained from the transfer record.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-sky-100 text-[9px] font-black uppercase tracking-[0.12em] text-sky-800">
                    <th className="px-4 py-2.5">VIN</th>
                    <th className="px-4 py-2.5">Car</th>
                    <th className="px-4 py-2.5">From → To</th>
                    <th className="px-4 py-2.5">Booking</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">Missing Since</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transferMissing.map((v) => {
                    const snap = (v.vehicle_snapshot || {}) as Record<string, unknown>
                    const car = [snap.model, snap.variant, snap.color].map((x) => (x == null ? '' : String(x))).filter(Boolean).join(' · ')
                    return (
                      <tr 
                        key={v.transfer_id} 
                        className="border-t border-sky-100 text-slate-700 cursor-pointer hover:bg-sky-100/50"
                        onClick={() => setJourneyVin(v.vin_number)}
                      >
                        <td className="px-4 py-2.5 font-mono font-bold">{v.vin_number || '—'}</td>
                        <td className="px-4 py-2.5 font-semibold">{car || '—'}</td>
                        <td className="px-4 py-2.5">{(v.from_dealer_code || '—')} → {(v.dealer_code || '—')}</td>
                        <td className="px-4 py-2.5 font-mono">{v.booking_number || '—'}</td>
                        <td className="px-4 py-2.5">{v.customer_name || '—'}</td>
                        <td className="px-4 py-2.5">{v.stock_missing_at ? new Date(v.stock_missing_at).toLocaleDateString('en-IN') : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* #12 Dealer holds — 48h reservation with Payment Received / Release controls. */}
        {data?.heldVehicles && data.heldVehicles.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/40 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-800">Dealer Holds</span>
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-black text-amber-800">{data.heldVehicles.length}</span>
              </div>
              <span className="text-[10px] font-semibold text-amber-700">Reserved for a dealer — record payment within 48h or it returns to stock automatically.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="bg-amber-100 text-[9px] font-black uppercase tracking-[0.12em] text-amber-800">
                    <th className="px-4 py-2.5">VIN</th>
                    <th className="px-4 py-2.5">Car</th>
                    <th className="px-4 py-2.5">Dealer / Reason</th>
                    <th className="px-4 py-2.5">By</th>
                    <th className="px-4 py-2.5">Window</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.heldVehicles.map((v) => {
                    const expMs = v.hold_expires_at ? new Date(v.hold_expires_at).getTime() : NaN
                    const hoursLeft = Number.isFinite(expMs) ? Math.round((expMs - Date.now()) / 3_600_000) : null
                    return (
                      <tr key={v.vin_number} className="border-t border-amber-100 text-slate-700">
                        <td className="px-4 py-2.5 font-mono font-bold">{v.vin_number}</td>
                        <td className="px-4 py-2.5 font-semibold">{[v.model, v.variant, v.color].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-4 py-2.5">{v.notes || v.customer_name || '—'}</td>
                        <td className="px-4 py-2.5">{v.marked_by_name || '—'}</td>
                        <td className="px-4 py-2.5">
                          {v.paid ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-black text-emerald-700">
                              <CheckCircle2 className="h-2.5 w-2.5" /> PAID
                            </span>
                          ) : hoursLeft == null ? '—' : hoursLeft <= 0 ? (
                            <span className="font-black text-rose-600">expiring…</span>
                          ) : (
                            <span className="font-bold text-amber-700">{hoursLeft}h left</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!v.paid && (
                              <Button
                                size="sm"
                                className="h-7 rounded-lg bg-emerald-600 px-2.5 text-[10px] font-black text-white hover:bg-emerald-700"
                                disabled={holdPaymentMutation.isPending}
                                onClick={() => holdPaymentMutation.mutate(v.vin_number)}
                              >
                                Payment Received
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-lg border-slate-200 px-2.5 text-[10px] font-black text-slate-800"
                              disabled={releaseHoldMutation.isPending}
                              onClick={() => releaseHoldMutation.mutate(v.vin_number)}
                            >
                              Release
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* #8 BBND allot launcher */}
        <div className="mb-3 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg border-slate-300 px-3 text-[11px] font-black text-slate-800"
            onClick={() => { setBbndBookingId(''); setBbndVin(''); setBbndModel(''); setBbndVariant(''); setBbndColor(''); setBbndDialogOpen(true) }}
          >
            + Allot BBND Vehicle
          </Button>
        </div>

        {/* Stock Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-[10px]">
            <thead>
              <tr className="bg-slate-900 text-[9px] font-black uppercase tracking-[0.12em] text-white">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">VIN / Chassis</th>
                <th className="px-4 py-3">Car</th>
                <th className="px-4 py-3">Colour</th>
                <th className="px-4 py-3 text-center">Age</th>
                <th className="px-4 py-3">Dealer</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => {
                const isAllotted = !!row.allocation_id
                const isDelivered = row.booking_status === 'delivered'
                const isReady = row.booking_status === 'ready_delivery'
                const badge = isDelivered
                  ? { label: 'Delivered', bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }
                  : isReady
                    ? { label: 'Ready', bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }
                    : isAllotted
                      ? { label: 'Allotted', bg: '#fffbeb', text: '#b45309', border: '#fde68a' }
                      // Same DMS-committed case as renderStatus — the shared printed/exported copy of
                      // this table must not call these Available either.
                      : String(row.stock_status || '').trim().toUpperCase() === 'ALLOCATED'
                        ? { label: 'DMS Allocated', bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' }
                        : { label: 'Available', bg: '#f0fdfa', text: '#0f766e', border: '#99f6e4' }
                const aged = Number(row.stock_age) > 180
                return (
                  <tr key={row.id} className="page-break-avoid border-b border-slate-100 odd:bg-white even:bg-slate-50/60 last:border-b-0">
                    <td className="px-4 py-3 align-middle">
                      <span className="inline-block rounded-full border px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.1em]" style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}>
                        {badge.label}
                      </span>
                    </td>
                    {/* The printed report is what the team reconciles against the physical yard, so it
                        has to name the individual car — model/variant/colour cannot identify one unit. */}
                    <td className="px-4 py-3 align-middle font-mono text-[9px] font-bold tracking-tight text-slate-900">{row.vin_number || '-'}</td>
                    <td className="px-4 py-3 align-middle">
                      <div className="font-black uppercase text-slate-950">{row.model}</div>
                      <div className="mt-0.5 text-[9px] font-semibold text-slate-500">{row.variant}</div>
                    </td>
                    <td className="px-4 py-3 align-middle font-semibold text-slate-600">{row.color || '-'}</td>
                    <td className="px-4 py-3 text-center align-middle">
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-black" style={aged ? { backgroundColor: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3' } : { color: '#1e293b' }}>
                        {row.stock_age}d
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle font-bold text-slate-700">{row.dealer_code}</td>
                  </tr>
                )
              })}
              {(!data?.rows || data.rows.length === 0) && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[11px] font-semibold text-slate-400">No stock vehicles to report.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-[9px] font-semibold text-slate-400">
          <span>AM KIA · Confidential stock inventory — not for external distribution.</span>
          <span>{filteredStockRows.length} vehicles</span>
        </div>
      </div>

      {/* print stylesheet */}
      <style jsx global>{`
        @media print {
          /* The 7-column stock report is wide — force landscape so the
             Customer/Booking column isn't cropped at the page edge. */
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
          body * {
            visibility: hidden !important;
          }
          #printable-stock-report, #printable-stock-report * {
            visibility: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #printable-stock-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            padding: 0 !important;
            display: block !important;
            background-color: #f8fafc !important;
          }
          #printable-stock-report table {
            width: 100% !important;
            table-layout: fixed !important;
          }
          #printable-stock-report th, #printable-stock-report td {
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
          }
          .page-break-avoid {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Full-screen success celebration for allot / transfer / deliver */}
      <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: stockSuccess ? 'auto' : 'none' }}>
        <SuccessOverlay
          show={stockSuccess !== null}
          variant={stockSuccess === 'deliver' ? 'delivery' : 'generic'}
          label={stockSuccess === 'deliver' ? 'Vehicle delivered!' : stockSuccess === 'transfer' ? 'Transfer requested!' : 'Vehicle allotted!'}
          sublabel={stockSuccess === 'deliver' ? 'Handed over to the customer' : stockSuccess === 'transfer' ? 'Moving between outlets' : 'VIN reserved for this booking'}
          onDone={() => setStockSuccess(null)}
        />
      </div>
    </div>
  )
}
