'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
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
} from 'lucide-react'

interface Vendor {
  id: string
  name: string
  gstNumber: string
  email: string | null
  phone: string | null
  address: string | null
  createdAt: string
  updatedAt: string
}

interface VendorFormState {
  name: string
  gstNumber: string
  email: string
  phone: string
  address: string
}

const EMPTY_FORM: VendorFormState = {
  name: '',
  gstNumber: '',
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
  if (!gst) return 'GST Number is required'
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

  // ── Fetch vendors ──
  const { data, isLoading, refetch, isFetching } = useQuery<{ vendors: Vendor[] }>({
    queryKey: ['kia-vendors'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/vendors')
      if (!res.ok) throw new Error('Failed to load vendors')
      return res.json()
    },
  })

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (payload: VendorFormState) => {
      const res = await fetch('/api/brands/kia/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name.trim(),
          gstNumber: payload.gstNumber.trim().toUpperCase(),
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
          gstNumber: payload.gstNumber.trim().toUpperCase(),
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
        v.gstNumber.toLowerCase().includes(q) ||
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
      gstNumber: vendor.gstNumber,
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
      subtitle="Manage vendors used in KIA payment approval requests"
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
              className="h-10 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 font-black text-sm flex-1 sm:flex-none"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Vendor
            </Button>
          </div>
        </div>

        {/* ── Add / Edit Form ── */}
        {showForm && (
          <div className="bg-white rounded-3xl border-2 border-indigo-200 shadow-[0_20px_60px_rgba(99,102,241,0.12)] overflow-hidden">
            {/* Form header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    {editVendor ? 'Edit Vendor' : 'Add New Vendor'}
                  </h3>
                  <p className="text-xs text-indigo-200 font-medium">
                    {editVendor ? `Editing: ${editVendor.name}` : 'Enter vendor details for the registry'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditVendor(null); setForm(EMPTY_FORM) }}
                className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-white" />
              </button>
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

                {/* GST Number — mandatory */}
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                    GST Number (GSTIN) <span className="text-rose-500 text-sm">*</span>
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      required
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
                  disabled={isSaving || !!gstError || !form.name.trim() || !form.gstNumber}
                  className="h-11 px-8 rounded-2xl bg-indigo-600 hover:bg-indigo-700 font-black flex-1 sm:flex-none"
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
          </div>
        )}

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
                : 'Add your first vendor to the registry so it appears in payment approval forms.'}
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
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Vendor / Firm Name</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">GST Number</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Email</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Phone</th>
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Address</th>
                    <th className="text-right py-3 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVendors.map((vendor, idx) => (
                    <tr key={vendor.id} className="group hover:bg-slate-50/70 transition-colors">
                      <td className="py-4 px-6 text-sm font-black text-slate-300">{idx + 1}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-4 h-4 text-indigo-500" />
                          </div>
                          <span className="text-sm font-black text-slate-900 leading-tight">{vendor.name}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg tracking-wider">
                          {vendor.gstNumber}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-sm text-slate-600 font-medium">{vendor.email || <span className="text-slate-300">—</span>}</td>
                      <td className="py-4 px-4 text-sm text-slate-600 font-medium">{vendor.phone || <span className="text-slate-300">—</span>}</td>
                      <td className="py-4 px-4 max-w-[200px]">
                        <span className="text-sm text-slate-600 font-medium truncate block">{vendor.address || <span className="text-slate-300">—</span>}</span>
                      </td>
                      <td className="py-4 px-6">
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
                <div key={vendor.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-indigo-500" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900">{vendor.name}</p>
                        <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md tracking-wider">
                          {vendor.gstNumber}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-black text-slate-300">#{idx + 1}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
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

                  <div className="flex items-center gap-2 pt-1">
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
    </MainLayout>
  )
}
