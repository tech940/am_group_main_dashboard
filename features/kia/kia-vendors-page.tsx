'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Building2,
  Plus,
  Search,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Phone,
  Mail,
  MapPin,
  Hash,
  Users,
  X,
  CheckCircle2,
  Loader2,
  Edit3,
  ExternalLink,
  FileText,
  Check,
  Calendar,
  AlertTriangle,
  Info
} from 'lucide-react'

interface Vendor {
  id: string
  name: string
  gstNumber: string | null
  vendorCode: string | null
  bankAccountNumber: string | null
  email: string | null
  phone: string | null
  address: string | null
  createdAt: string
  updatedAt: string
}

interface VendorFormState {
  name: string
  gstNumber: string
  bankAccountNumber: string
  email: string
  phone: string
  address: string
}

const EMPTY_FORM: VendorFormState = {
  name: '',
  gstNumber: '',
  bankAccountNumber: '',
  email: '',
  phone: '',
  address: '',
}

function formatGst(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15)
}

function formatPhone(raw: string) {
  return raw.replace(/[^\d+\s\-()]/g, '').slice(0, 15)
}

function validateGst(gst: string): string | null {
  if (!gst || gst.trim() === '') return null // optional GST
  const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
  if (!regex.test(gst)) return 'Invalid format — expected 15-char GSTIN (e.g. 01ABCDE1234A1Z5)'
  return null
}

export function KiaVendorsClient() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editVendor, setEditVendor] = useState<Vendor | null>(null)
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM)
  const [gstError, setGstError] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [selectedVendorForLedger, setSelectedVendorForLedger] = useState<Vendor | null>(null)
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState<any | null>(null)
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null)
  const [showAddGlDialog, setShowAddGlDialog] = useState(false)

  // ── Fetch vendors ──
  const { data, isLoading, refetch, isFetching } = useQuery<{ vendors: Vendor[] }>({
    queryKey: ['kia-vendors'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/vendors')
      if (!res.ok) throw new Error('Failed to load vendors')
      return res.json()
    },
  })

  // ── Fetch payments ledger for selected vendor ──
  const { data: ledgerData, isLoading: loadingLedger } = useQuery<{ vendor: Vendor; payments: any[] }>({
    queryKey: ['vendor-payments', selectedVendorForLedger?.id],
    queryFn: async () => {
      if (!selectedVendorForLedger) return { vendor: selectedVendorForLedger!, payments: [] }
      const res = await fetch(`/api/brands/kia/vendors/${selectedVendorForLedger.id}/payments`)
      if (!res.ok) throw new Error('Failed to load ledger')
      return res.json()
    },
    enabled: Boolean(selectedVendorForLedger)
  })

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (payload: VendorFormState) => {
      const res = await fetch('/api/brands/kia/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name.trim(),
          gstNumber: payload.gstNumber.trim().toUpperCase() || null,
          bankAccountNumber: payload.bankAccountNumber.trim() || null,
          email: payload.email.trim() || null,
          phone: payload.phone.trim() || null,
          address: payload.address.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to create vendor')
      return data
    },
    onSuccess: () => {
      toast({ title: 'Vendor added', description: 'New vendor saved to the registry.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-vendors'] })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setGstError(null)
    },
    onError: (err) => {
      toast({ title: 'Failed to add vendor', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' })
    },
  })

  // ── Update mutation ──
  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: VendorFormState }) => {
      const res = await fetch(`/api/brands/kia/vendors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name.trim(),
          gstNumber: payload.gstNumber.trim().toUpperCase() || null,
          bankAccountNumber: payload.bankAccountNumber.trim() || null,
          email: payload.email.trim() || null,
          phone: payload.phone.trim() || null,
          address: payload.address.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to update vendor')
      return data
    },
    onSuccess: () => {
      toast({ title: 'Vendor updated', description: 'Changes saved successfully.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-vendors'] })
      setEditVendor(null)
      setForm(EMPTY_FORM)
      setShowForm(false)
      setGstError(null)
    },
    onError: (err) => {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' })
    },
  })

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/brands/kia/vendors/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to delete vendor')
      return data
    },
    onSuccess: () => {
      toast({ title: 'Vendor removed', description: 'Vendor has been deleted from the registry.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-vendors'] })
      setDeleteConfirmId(null)
    },
    onError: (err) => {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' })
    },
  })

  const filteredVendors = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return data?.vendors || []
    return (data?.vendors || []).filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.gstNumber && v.gstNumber.toLowerCase().includes(q)) ||
        (v.vendorCode && v.vendorCode.toLowerCase().includes(q)) ||
        (v.bankAccountNumber && v.bankAccountNumber.includes(q)) ||
        v.email?.toLowerCase().includes(q) ||
        v.phone?.includes(q) ||
        v.address?.toLowerCase().includes(q)
    )
  }, [data?.vendors, search])

  function openAddForm() {
    setEditVendor(null)
    setForm(EMPTY_FORM)
    setGstError(null)
    setShowForm(true)
  }

  function openEditForm(vendor: Vendor) {
    setEditVendor(vendor)
    setForm({
      name: vendor.name,
      gstNumber: vendor.gstNumber || '',
      bankAccountNumber: vendor.bankAccountNumber || '',
      email: vendor.email || '',
      phone: vendor.phone || '',
      address: vendor.address || '',
    })
    setGstError(null)
    setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const gstErr = validateGst(form.gstNumber)
    setGstError(gstErr)
    if (gstErr) return
    if (!form.name.trim()) return

    if (editVendor) {
      updateMutation.mutate({ id: editVendor.id, payload: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <MainLayout
      title="Vendor Registry"
      subtitle="Manage vendors used in KIA vendor payment requests"
    >
      <div className="space-y-6">

        {/* ── KPI Strip ── */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Vendors</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-slate-900">{data?.vendors.length || 0}</span>
              <span className="text-xs font-semibold text-slate-500">registered</span>
            </div>
          </div>
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500">With Email</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-emerald-600">
                {data?.vendors.filter(v => v.email).length || 0}
              </span>
              <span className="text-xs font-semibold text-slate-500">vendors</span>
            </div>
          </div>
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between col-span-2 sm:col-span-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Showing</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-indigo-600">{filteredVendors.length}</span>
              <span className="text-xs font-semibold text-slate-500">result{filteredVendors.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        {/* ── Action Bar ── */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-4 flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, GST, email, phone..."
              className="pl-11 h-10 w-full rounded-2xl border-slate-200 font-semibold"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="h-10 rounded-2xl border-slate-200 font-bold"
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              type="button"
              onClick={openAddForm}
              className="h-10 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 font-black text-sm flex-1 sm:flex-none text-white"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Vendor
            </Button>
            <Button
              type="button"
              onClick={() => setShowAddGlDialog(true)}
              className="h-10 px-5 rounded-2xl bg-slate-900 hover:bg-slate-800 font-black text-sm flex-1 sm:flex-none text-white"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add GL Category
            </Button>
          </div>
        </div>

        {/* ── Add / Edit Form Modal ── */}
        <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditVendor(null); setForm(EMPTY_FORM); setGstError(null); } }}>
          <DialogContent className="rounded-[2rem] w-[calc(100vw-1.5rem)] sm:max-w-xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100">
            {/* Form header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-base font-black text-white">
                    {editVendor ? 'Edit Vendor' : 'Add New Vendor'}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-indigo-200 font-medium">
                    {editVendor ? `Editing: ${editVendor.name}` : 'Enter vendor details for the registry'}
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Form body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">

                {/* Vendor Name — mandatory */}
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                    Vendor / Firm Name <span className="text-rose-500 text-sm">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sharma Enterprises Pvt. Ltd."
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full h-11 pl-10 pr-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none bg-slate-50/50 text-sm font-semibold text-slate-800 transition-colors"
                    />
                  </div>
                </div>

                {/* GST Number — optional */}
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    GST Number (GSTIN) <span className="text-slate-300">(optional)</span>
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. 01ABCDE1234A1Z5"
                      value={form.gstNumber}
                      onChange={e => {
                        const val = formatGst(e.target.value)
                        setForm(f => ({ ...f, gstNumber: val }))
                        setGstError(validateGst(val))
                      }}
                      maxLength={15}
                      className={`w-full h-11 pl-10 pr-4 rounded-2xl border-2 focus:outline-none bg-slate-50/50 text-sm font-mono font-semibold text-slate-800 uppercase tracking-wider transition-colors ${
                        gstError ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-500'
                      }`}
                    />
                    {form.gstNumber.length === 15 && !gstError && (
                      <CheckCircle2 className="absolute right-3.5 top-3.5 w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                  {gstError && (
                    <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                      <span>⚠</span> {gstError}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 font-medium">
                    Format: 2-digit state code + 10-char PAN + 3 chars (e.g. 01ABCDE1234A1Z5)
                  </p>
                </div>

                {/* Bank Account Number — optional */}
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Bank Account Number <span className="text-slate-300">(optional, numbers only, no IFSC)</span>
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. 50200012345678"
                      value={form.bankAccountNumber}
                      onChange={e => setForm(f => ({ ...f, bankAccountNumber: e.target.value.replace(/\D/g, '') }))}
                      className="w-full h-11 pl-10 pr-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none bg-slate-50/50 text-sm font-semibold text-slate-800 transition-colors"
                    />
                  </div>
                </div>

                {/* Email — optional */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Email Address <span className="text-slate-300">(optional)</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      placeholder="vendor@example.com"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full h-11 pl-10 pr-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none bg-slate-50/50 text-sm font-semibold text-slate-800 transition-colors"
                    />
                  </div>
                </div>

                {/* Phone — optional */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Phone Number <span className="text-slate-300">(optional)</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="tel"
                      placeholder="+91 98765 43210"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                      className="w-full h-11 pl-10 pr-4 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none bg-slate-50/50 text-sm font-semibold text-slate-800 transition-colors"
                    />
                  </div>
                </div>

                {/* Address — optional */}
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Business Address <span className="text-slate-300">(optional)</span>
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                    <textarea
                      rows={2}
                      placeholder="Shop No., Street, City, State, PIN"
                      value={form.address}
                      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      className="w-full pl-10 pr-4 pt-3 pb-3 rounded-2xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none bg-slate-50/50 text-sm font-semibold text-slate-800 resize-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Submit buttons */}
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-2xl font-bold border-slate-200"
                  onClick={() => { setShowForm(false); setEditVendor(null); setForm(EMPTY_FORM) }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving || (form.gstNumber.trim().length > 0 && !!gstError) || !form.name.trim()}
                  className="h-11 px-8 rounded-2xl bg-indigo-600 hover:bg-indigo-700 font-black flex-1 sm:flex-none text-white"
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                  ) : editVendor ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" />Update Vendor</>
                  ) : (
                    <><Plus className="w-4 h-4 mr-2" />Add to Registry</>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Vendor Table ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mr-3" />
            <span className="text-sm font-semibold">Loading vendors...</span>
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-24 text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border-2 border-slate-100 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-1">
              {search ? 'No vendors match your search' : 'No vendors yet'}
            </h3>
            <p className="text-sm text-slate-400 font-medium mb-6 max-w-xs">
              {search
                ? `Try a different search term.`
                : 'Add your first vendor to the registry so it appears in vendor payment forms.'}
            </p>
            {!search && (
              <Button onClick={openAddForm} className="rounded-2xl bg-indigo-600 hover:bg-indigo-700 font-black">
                <Plus className="w-4 h-4 mr-2" /> Add First Vendor
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] overflow-hidden">
            {/* Table header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-black text-slate-800">Vendor Registry</span>
                <Badge className="ml-1 bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-black">
                  {filteredVendors.length}
                </Badge>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Name · GST · Contact
              </span>
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left py-3 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Vendor / Firm Name</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">GST Number</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Bank Account</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Email</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Phone</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Address</th>
                    <th className="text-right py-3 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVendors.map((vendor, idx) => (
                    <tr
                      key={vendor.id}
                      onClick={() => setSelectedVendorForLedger(vendor)}
                      className="group hover:bg-slate-50/70 transition-colors cursor-pointer"
                    >
                      <td className="py-4 px-6 text-sm font-black text-slate-300">{idx + 1}</td>
                      <td className="py-4 px-4">
                        <span className="text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {vendor.vendorCode || '—'}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-4 h-4 text-indigo-500" />
                          </div>
                          <span className="text-sm font-black text-slate-900 leading-tight">{vendor.name}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {vendor.gstNumber ? (
                          <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg tracking-wider">
                            {vendor.gstNumber}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-sm text-slate-600 font-mono font-bold">
                        {vendor.bankAccountNumber || <span className="text-slate-300 font-sans font-medium">—</span>}
                      </td>
                      <td className="py-4 px-4 text-sm text-slate-600 font-medium">{vendor.email || <span className="text-slate-300">—</span>}</td>
                      <td className="py-4 px-4 text-sm text-slate-600 font-medium">{vendor.phone || <span className="text-slate-300">—</span>}</td>
                      <td className="py-4 px-4 max-w-[200px]">
                        <span className="text-sm text-slate-600 font-medium truncate block">{vendor.address || <span className="text-slate-300">—</span>}</span>
                      </td>
                      <td className="py-4 px-6" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(vendor)}
                            className="w-8 h-8 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 flex items-center justify-center transition-colors"
                            title="Edit vendor"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                          </button>
                          {deleteConfirmId === vendor.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => deleteMutation.mutate(vendor.id)}
                                disabled={deleteMutation.isPending}
                                className="text-[10px] font-black uppercase px-3 py-1.5 rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                              >
                                {deleteMutation.isPending ? '...' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="text-[10px] font-black uppercase px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(vendor.id)}
                              className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-100 flex items-center justify-center transition-colors"
                              title="Delete vendor"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filteredVendors.map((vendor, idx) => (
                <div
                  key={vendor.id}
                  onClick={() => setSelectedVendorForLedger(vendor)}
                  className="p-4 space-y-3 hover:bg-slate-50/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-indigo-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-black text-slate-900">{vendor.name}</p>
                          <span className="text-[9px] font-black text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {vendor.vendorCode || '—'}
                          </span>
                        </div>
                        {vendor.gstNumber ? (
                          <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md tracking-wider inline-block mt-1">
                            GST: {vendor.gstNumber}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">No GST</span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-black text-slate-300">#{idx + 1}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {vendor.bankAccountNumber && (
                      <div className="col-span-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400">BANK:</span>
                        <span className="text-xs font-mono font-bold text-slate-700">{vendor.bankAccountNumber}</span>
                      </div>
                    )}
                    {vendor.email && (
                      <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-slate-700 truncate">{vendor.email}</span>
                      </div>
                    )}
                    {vendor.phone && (
                      <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-slate-700">{vendor.phone}</span>
                      </div>
                    )}
                    {vendor.address && (
                      <div className="col-span-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-slate-700 line-clamp-1">{vendor.address}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openEditForm(vendor)}
                      className="flex-1 h-9 rounded-xl border-2 border-indigo-200 bg-indigo-50 text-xs font-black text-indigo-700 flex items-center justify-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> Edit
                    </button>
                    {deleteConfirmId === vendor.id ? (
                      <div className="flex gap-1.5 flex-1">
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate(vendor.id)}
                          className="flex-1 h-9 rounded-xl bg-rose-600 text-white text-xs font-black"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="flex-1 h-9 rounded-xl bg-slate-100 text-slate-600 text-xs font-black"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(vendor.id)}
                        className="flex-1 h-9 rounded-xl border-2 border-rose-200 bg-rose-50 text-xs font-black text-rose-600 flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Vendor Ledger Modal ── */}
      <Dialog open={selectedVendorForLedger !== null} onOpenChange={(open) => { if (!open) setSelectedVendorForLedger(null) }}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-y-auto rounded-3xl p-6 sm:p-8">
          {selectedVendorForLedger && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-black uppercase tracking-widest">
                  <Building2 className="w-4 h-4" />
                  <span>Vendor Ledger & Payment History / विक्रेता बहीखाता</span>
                </div>
                <DialogTitle className="text-xl sm:text-2xl font-black text-slate-900 mt-1 flex items-center gap-2.5">
                  {selectedVendorForLedger.name}
                  {selectedVendorForLedger.vendorCode && (
                    <Badge className="bg-slate-900 text-white text-[10px] font-black">{selectedVendorForLedger.vendorCode}</Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400 font-semibold mt-1">
                  Complete view of invoices, approvals and payments across all dealership companies.
                </DialogDescription>
              </DialogHeader>

              {loadingLedger ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <span className="text-xs font-semibold">Fetching payment ledger...</span>
                </div>
              ) : (
                <div className="space-y-6 mt-4">
                  {/* Vendor Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 bg-slate-50 border border-slate-100 p-4 rounded-2xl text-xs font-semibold text-slate-700">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">GST Number</span>
                      <span className="font-mono font-bold text-slate-900">{ledgerData?.vendor?.gstNumber || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">Bank Account Number</span>
                      <span className="font-mono font-bold text-slate-900">{ledgerData?.vendor?.bankAccountNumber || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">Email / Phone</span>
                      <span className="text-slate-900">
                        {ledgerData?.vendor?.email || '—'} / {ledgerData?.vendor?.phone || '—'}
                      </span>
                    </div>
                  </div>

                  {/* Summary Cards */}
                  {(() => {
                    const payments = ledgerData?.payments || []
                    const totalPaid = payments
                      .filter((p: any) => p.paymentStatus === 'PAID')
                      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)
                    const totalPending = payments
                      .filter((p: any) => p.paymentStatus !== 'PAID' && !p.managementApproval?.startsWith('REJECTED'))
                      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex flex-col justify-between">
                          <span className="text-[9px] font-black uppercase tracking-wider text-emerald-800">Total Paid (सकल भुगतान)</span>
                          <span className="text-2xl font-black text-emerald-600 tracking-tight mt-1 font-sans">₹{totalPaid.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl flex flex-col justify-between">
                          <span className="text-[9px] font-black uppercase tracking-wider text-indigo-800">Unpaid / In Approval Stage</span>
                          <span className="text-2xl font-black text-indigo-600 tracking-tight mt-1 font-sans">₹{totalPending.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col justify-between">
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Total Requests Count</span>
                          <span className="text-2xl font-black text-slate-900 tracking-tight mt-1">{payments.length}</span>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Payments Timeline / Table */}
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-indigo-500" />
                      Cross-Company Payments List / भुगतान सूची
                    </h4>

                    {(!ledgerData?.payments || ledgerData.payments.length === 0) ? (
                      <div className="text-center py-10 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-semibold text-slate-400">
                        No payment requests found for this vendor.
                      </div>
                    ) : (
                      <div className="border border-slate-100 rounded-2xl overflow-hidden overflow-x-auto">
                        <table className="w-full text-xs text-left font-semibold text-slate-700">
                          <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
                            <tr>
                              <th className="py-2.5 px-4">Date</th>
                              <th className="py-2.5 px-4">Company</th>
                              <th className="py-2.5 px-4">Invoice / Ref No.</th>
                              <th className="py-2.5 px-4 text-right">Amount</th>
                              <th className="py-2.5 px-4">Approval Status</th>
                              <th className="py-2.5 px-4">Payment</th>
                              <th className="py-2.5 px-4 text-right">Documents</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {ledgerData.payments.map((payment: any) => {
                              const isPaid = payment.paymentStatus === 'PAID'
                              return (
                                <tr 
                                  key={payment.id} 
                                  onClick={() => setSelectedPaymentDetail(payment)}
                                  className="hover:bg-indigo-50/45 cursor-pointer transition-colors"
                                >
                                  <td className="py-3 px-4 font-semibold text-slate-500">
                                    {new Date(payment.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </td>
                                  <td className="py-3 px-4">
                                    <Badge className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50 border border-indigo-100 uppercase font-black text-[9px] rounded-full">
                                      {payment.brand || 'KIA'}
                                    </Badge>
                                  </td>
                                  <td className="py-3 px-4 font-mono font-bold text-slate-800">
                                    {payment.invoiceNumber || '—'}
                                  </td>
                                  <td className="py-3 px-4 text-right font-black text-slate-900 font-sans">
                                    ₹{Number(payment.amount || 0).toLocaleString('en-IN')}
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className={cn(
                                      "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border",
                                      payment.managementApproval === 'APPROVED' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                      payment.managementApproval?.startsWith('REJECTED') ? "bg-rose-50 text-rose-700 border-rose-200" :
                                      "bg-amber-50 text-amber-700 border-amber-200"
                                    )}>
                                      {payment.managementApproval || 'PENDING'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className={cn(
                                      "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border",
                                      isPaid ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-600 border-slate-200"
                                    )}>
                                      {isPaid ? 'PAID' : 'UNPAID'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {(payment.uploadBillUrl1 || payment.uploadBillUrl2) && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewDocUrl(payment.uploadBillUrl1 || payment.uploadBillUrl2)}
                                          className="text-indigo-600 hover:underline flex items-center gap-0.5 font-bold cursor-pointer"
                                          title="View Invoice Bill"
                                        >
                                          <FileText className="w-3.5 h-3.5" /> Bill
                                        </button>
                                      )}
                                      {payment.paymentProofUrl && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewDocUrl(payment.paymentProofUrl)}
                                          className="text-emerald-600 hover:underline flex items-center gap-0.5 font-bold cursor-pointer"
                                          title="View Payment Proof"
                                        >
                                          <Check className="w-3.5 h-3.5" /> Proof
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Document Preview Modal ── */}
      <Dialog open={previewDocUrl !== null} onOpenChange={(open) => { if (!open) setPreviewDocUrl(null) }}>
        <DialogContent className="max-w-4xl w-[95vw] h-[85vh] p-4 flex flex-col rounded-3xl overflow-hidden">
          <DialogHeader className="pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="text-sm font-black text-slate-800">Document Attachment Preview / दस्तावेज़ पूर्वावलोकन</DialogTitle>
              <DialogDescription className="text-[10px] text-slate-400 font-semibold">Supporting invoice bill or payment proof receipt.</DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => {
                if (previewDocUrl) {
                  window.open(previewDocUrl, '_blank')
                }
              }}
              className="text-[10px] font-black uppercase text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer mr-8"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open in New Tab
            </button>
          </DialogHeader>
          <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden flex items-center justify-center p-2">
            {previewDocUrl ? (
              previewDocUrl.toLowerCase().endsWith('.pdf') ? (
                <iframe src={previewDocUrl} className="w-full h-full rounded-xl border-none" />
              ) : (
                <img src={previewDocUrl} alt="Document Attachment Preview" className="max-w-full max-h-full object-contain rounded-xl shadow-sm" />
              )
            ) : (
              <span className="text-xs text-slate-400">No document to preview</span>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Payment Request Details Overlay Modal ── */}
      <Dialog open={selectedPaymentDetail !== null} onOpenChange={(open) => { if (!open) setSelectedPaymentDetail(null) }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-2xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
          {selectedPaymentDetail && (() => {
            const row = selectedPaymentDetail
            return (
              <>
                <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
                        Payment Request Details
                      </DialogTitle>
                      <DialogDescription className="text-xs text-slate-500 font-semibold mt-1">
                        View workflow status and metadata parameters.
                      </DialogDescription>
                    </div>
                    <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase font-black text-[9px] rounded-full">
                      {row.brand || 'KIA'}
                    </Badge>
                  </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Overview Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Requester</span>
                      <p className="text-xs font-bold text-slate-800">{row.name}</p>
                      <p className="text-[10px] text-slate-400 font-medium">{row.email}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Vendor / Firm Name</span>
                      <p className="text-xs font-black text-slate-900">{row.vendorName || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Amount / राशि</span>
                      <p className="text-sm font-black text-slate-950">₹{Number(row.amount || 0).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Payment Type</span>
                      <p className="text-xs font-bold text-slate-700">{row.typeOfPayment || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Invoice Number</span>
                      <p className="text-xs font-mono font-bold text-slate-800">{row.invoiceNumber || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">UTR / Txn ID</span>
                      <p className="text-xs font-mono font-bold text-slate-800">{row.utrNumber || '—'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Created At</span>
                      <p className="text-xs font-bold text-slate-700">{new Date(row.createdAt).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Workflow Status</span>
                      <p className="text-xs font-black uppercase text-indigo-600">{row.paymentStatus === 'PAID' ? 'PAID / भुगतान किया' : 'UNPAID / लंबित'}</p>
                    </div>
                  </div>

                  {/* Documents Section */}
                  <div className="space-y-2 pt-4 border-t border-slate-100">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Attached Documents</span>
                    <div className="flex flex-wrap gap-3">
                      {(row.uploadBillUrl1 || row.uploadBillUrl2) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPaymentDetail(null)
                            setPreviewDocUrl(row.uploadBillUrl1 || row.uploadBillUrl2)
                          }}
                          className="h-10 px-4 rounded-xl border border-slate-200 hover:border-indigo-200 bg-white hover:bg-indigo-50/20 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer animate-in fade-in"
                        >
                          <FileText className="w-4 h-4 text-indigo-500" />
                          View Invoice Bill
                        </button>
                      )}
                      {row.paymentProofUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPaymentDetail(null)
                            setPreviewDocUrl(row.paymentProofUrl)
                          }}
                          className="h-10 px-4 rounded-xl border border-slate-200 hover:border-emerald-200 bg-white hover:bg-emerald-50/20 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-all shadow-sm cursor-pointer animate-in fade-in"
                        >
                          <Check className="w-4 h-4 text-emerald-500" />
                          View Payment Proof
                        </button>
                      )}
                    </div>
                  </div>

                  {/* History Logs */}
                  {Array.isArray(row.history) && row.history.length > 0 && (
                    <div className="space-y-2 pt-4 border-t border-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Approval History Logs</span>
                      <div className="space-y-3">
                        {row.history.map((log: any, hIdx: number) => (
                          <div key={log.id || hIdx} className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex justify-between gap-3 text-xs leading-normal animate-in fade-in">
                            <div>
                              <p className="font-bold text-slate-800">
                                {log.role} Stage: <span className="font-black text-slate-900 uppercase">{log.action === 'APPROVED' ? 'Approved' : log.action === 'SENT BACK' ? 'Sent Back' : log.action}</span>
                              </p>
                              {log.remarks && (
                                <p className="text-slate-500 mt-1 italic font-semibold">"{log.remarks}"</p>
                              )}
                              <p className="text-[10px] text-slate-400 font-medium mt-1">By {log.user || 'System'}</p>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0">
                              {new Date(log.timestamp).toLocaleDateString('en-IN')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                  <Button variant="outline" onClick={() => setSelectedPaymentDetail(null)} className="h-10 rounded-2xl text-xs font-black border-slate-200">
                    Close Details
                  </Button>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Add GL Category Dialog ── */}
      <AddGlDialog
        open={showAddGlDialog}
        onOpenChange={setShowAddGlDialog}
        onSuccess={() => {
          toast({ title: 'GL Category added', description: 'New GL category saved successfully.', variant: 'success' })
        }}
      />
    </MainLayout>
  )
}

interface AddGlDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function AddGlDialog({ open, onOpenChange, onSuccess }: AddGlDialogProps) {
  const [glName, setGlName] = useState('')
  const [tallyGroup, setTallyGroup] = useState('Indirect Expenses')
  const [isPending, setIsPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!glName.trim()) {
      toast({ title: 'Required Fields', description: 'Please fill GL Name.', variant: 'error' })
      return
    }

    setIsPending(true)
    try {
      const res = await fetch('/api/brands/kia/gl-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          glName: glName.trim(),
          tallyGroup: tallyGroup.trim(),
          accountNature: 'Expense',
          accountType: 'Indirect',
          monthlyBudget: '0.00'
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to create GL category')
      }
      onSuccess()
      setGlName('')
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Something went wrong.', variant: 'error' })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6 shadow-2xl border border-slate-100">
        <DialogHeader>
          <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
            Create GL Category
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-semibold mt-1">
            Add a new General Ledger account category to the system.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-1.5 bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              GL Code / जीएल कोड
            </span>
            <span className="text-xs font-black text-indigo-600 font-mono">
              [ System Generated / सिस्टम द्वारा जनरेटेड ]
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              GL Category Name / जीएल श्रेणी का नाम
            </label>
            <Input
              value={glName}
              onChange={e => setGlName(e.target.value)}
              placeholder="e.g. Office Stationery"
              required
              className="rounded-2xl bg-slate-50/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Tally Group / टैली ग्रुप
            </label>
            <select
              value={tallyGroup}
              onChange={e => setTallyGroup(e.target.value)}
              className="w-full h-10 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <option value="Indirect Expenses">Indirect Expenses (अप्रत्यक्ष खर्च)</option>
              <option value="Direct Expenses">Direct Expenses (प्रत्यक्ष खर्च)</option>
              <option value="Administrative Expenses">Administrative Expenses (प्रशासनिक खर्च)</option>
              <option value="Selling & Distribution">Selling & Distribution (बिक्री और वितरण)</option>
            </select>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              className="h-11 px-5 rounded-2xl text-xs font-black border-slate-200"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-11 px-5 rounded-2xl text-xs font-black text-white hover:opacity-90 bg-indigo-600"
            >
              {isPending ? 'Creating...' : 'Create Category'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
