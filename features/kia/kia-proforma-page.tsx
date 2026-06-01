'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Columns3,
  FileText,
  Filter,
  Loader2,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UserCog,
  WalletCards,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { calculateKiaProformaPricing, getKiaBankOptions } from '@/lib/kia-proforma/pricing'

export type KiaProformaSection =
  | 'generate'
  | 'all'
  | 'finance-remarks'
  | 'pending-approval'
  | 'user-database'
  | 'analytics'
  | 'insights'

type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: string
  isApprover: boolean
}

type KiaProfile = {
  id: string
  email: string
  consultantName: string
  dealerLocation: string | null
  employeeCode: string | null
  status: string
  approver: boolean
  settings?: Record<string, unknown> | null
  lastActivityAt?: string | null
}

type PriceRow = {
  model: string
  trimDescription: string
  hyp?: string | null
  bankName?: string | null
  bankBranch?: string | null
  exShowroomPrice: string | number
  tcs: string | number
  registrationCharges: string | number
  statutoryCharges: string | number
  insurance: string | number
  fastag: string | number
  accessoriesKit: string | number
  extendedWarranty4thYear: string | number
  insuranceCompany?: string | null
}

type KiaProformaRow = {
  id: string
  entryTime: string
  proformaDate: string
  customerType: string
  customerName: string
  mobileNumber: string
  customerAddress: string
  customerEmail: string
  modelName: string
  trimDescription: string
  fuelType: string
  vehicleColor: string
  bankName: string
  bankBranch: string | null
  vehicleStatus: string
  loanAmount: string | number
  insuranceCompany: string | null
  exShowroom: string | number
  tcsValue: string | number
  registrationCharges: string | number
  insuranceValue: string | number
  fastagValue: string | number
  accessoriesKit: string | number
  extWarranty: string | number
  cashDiscount: string | number
  exchangeValue: string | number
  bookingAmount: string | number
  govtEmployeeDiscount: string | number
  additionalDiscount: string | number
  totalCustomerCost: string | number
  grandTotalCost: string | number
  loginEmail: string
  consultant: string
  location: string | null
  empCode: string | null
  approvalStatus: string
  approvedBy: string | null
  linkPreview: string | null
  financeStatus: string | null
  financeRemarks: string | null
  financeUpdatedTime: string | null
  addDiscApproval?: Record<string, unknown> | null
}

type OptionsPayload = {
  currentUser: CurrentUser
  profile: KiaProfile
  prices: PriceRow[]
  models: string[]
  trims: { model: string; trim_description: string }[]
  banks: { bank_name: string; bank_branch: string | null }[]
  insuranceCompanies: string[]
}

type FormState = {
  customerType: string
  proformaDate: string
  customerName: string
  mobileNumber: string
  customerAddress: string
  customerEmail: string
  modelName: string
  trimDescription: string
  fuelType: string
  vehicleColor: string
  bankName: string
  bankBranch: string
  vehicleStatus: string
  loanAmount: string
  insuranceCompany: string
  exShowroom: string
  tcsValue: string
  registrationCharges: string
  insuranceValue: string
  fastagValue: string
  accessoriesKit: string
  extWarranty: string
  cashDiscount: string
  exchangeValue: string
  bookingAmount: string
  govtEmployeeDiscount: string
  additionalDiscount: string
}

type VerifyState = Record<string, { status: string; reason: string }>

const FINANCE_STATUS_OPTIONS = ['Pending', 'Cancelled', 'Stock not available', 'Duplicate', 'Current month', 'Converted']
const FIELD_VERIFY = [
  ['cashDiscount', 'CASH DISCOUNT'],
  ['exchangeValue', 'EXCHANGE VALUE'],
  ['bookingAmount', 'BOOKING AMOUNT'],
  ['govtEmployeeDiscount', 'GOVT EMPLOYEE DISCOUNT'],
  ['additionalDiscount', 'ADDITIONAL DISCOUNT'],
  ['insuranceValue', 'INSURANCE VALUE'],
  ['extWarranty', 'EXT WARRANTY'],
] as const

const EMPTY_FORM: FormState = {
  customerType: 'Customer',
  proformaDate: new Date().toISOString().slice(0, 10),
  customerName: '',
  mobileNumber: '',
  customerAddress: '',
  customerEmail: '',
  modelName: '',
  trimDescription: '',
  fuelType: 'PETROL',
  vehicleColor: '',
  bankName: '',
  bankBranch: '',
  vehicleStatus: 'IN HOUSE',
  loanAmount: '',
  insuranceCompany: '',
  exShowroom: '0',
  tcsValue: '0',
  registrationCharges: '0',
  insuranceValue: '0',
  fastagValue: '0',
  accessoriesKit: '0',
  extWarranty: '0',
  cashDiscount: '0',
  exchangeValue: '0',
  bookingAmount: '0',
  govtEmployeeDiscount: '0',
  additionalDiscount: '0',
}

const TABLE_COLUMNS: { key: keyof KiaProformaRow | 'index'; label: string; numeric?: boolean }[] = [
  { key: 'index', label: '#' },
  { key: 'entryTime', label: 'Entry Time' },
  { key: 'proformaDate', label: 'Proforma Date' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'mobileNumber', label: 'Mobile Number' },
  { key: 'customerAddress', label: 'Customer Address' },
  { key: 'customerEmail', label: 'Customer Email' },
  { key: 'modelName', label: 'Model Name' },
  { key: 'trimDescription', label: 'Trim Description' },
  { key: 'bankName', label: 'Bank Name' },
  { key: 'bankBranch', label: 'Bank Branch' },
  { key: 'fuelType', label: 'Fuel Type' },
  { key: 'vehicleColor', label: 'Vehicle Color' },
  { key: 'exShowroom', label: 'Ex Showroom', numeric: true },
  { key: 'tcsValue', label: 'TCS Value', numeric: true },
  { key: 'registrationCharges', label: 'Registration Charges', numeric: true },
  { key: 'insuranceValue', label: 'Insurance Value', numeric: true },
  { key: 'insuranceCompany', label: 'Insurance Company' },
  { key: 'fastagValue', label: 'Fastag Value', numeric: true },
  { key: 'accessoriesKit', label: 'Accessories Kit', numeric: true },
  { key: 'extWarranty', label: 'Ext Warranty', numeric: true },
  { key: 'cashDiscount', label: 'Cash Discount', numeric: true },
  { key: 'exchangeValue', label: 'Exchange Value', numeric: true },
  { key: 'bookingAmount', label: 'Booking Amount', numeric: true },
  { key: 'govtEmployeeDiscount', label: 'Govt Employee Discount', numeric: true },
  { key: 'additionalDiscount', label: 'Additional Discount', numeric: true },
  { key: 'totalCustomerCost', label: 'Total Customer Cost', numeric: true },
  { key: 'grandTotalCost', label: 'Grand Total Cost', numeric: true },
  { key: 'loginEmail', label: 'Login Email' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'location', label: 'Location' },
  { key: 'empCode', label: 'Emp Code' },
  { key: 'approvalStatus', label: 'Approval Status' },
]

const CHART_COLORS = ['#8a1552', '#2563eb', '#f59e0b', '#ef4444', '#14b8a6', '#64748b', '#7c3aed']
const proformaPrimaryButton = 'kia-proforma-primary-action'
const proformaOutlineButton = 'kia-proforma-outline-action'

function asNumber(value: unknown) {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: unknown) {
  return `Rs ${Math.round(asNumber(value)).toLocaleString('en-IN')}`
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusClass(value?: string | null) {
  const status = String(value || '').toLowerCase()
  if (status.includes('approved') && !status.includes('not')) return 'border-[var(--dashboard-success-border)] bg-[var(--dashboard-success-bg)] text-[var(--dashboard-success)]'
  if (status.includes('not') || status.includes('cancel')) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status.includes('converted')) return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs font-bold text-rose-600">{error}</span>}
    </label>
  )
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input {...props} className={cn('h-11 rounded-xl border-[var(--dashboard-primary-border)] bg-white/90 font-semibold shadow-sm focus:border-[var(--dashboard-primary-light)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--dashboard-primary-light)_18%,transparent)]', props.className)} />
}

function DataListInput({
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  listId,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  options: string[]
  placeholder?: string
  listId: string
  disabled?: boolean
}) {
  return (
    <>
      <TextInput list={listId} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={placeholder} disabled={disabled} />
      <datalist id={listId}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </>
  )
}

function useOptions() {
  const [data, setData] = useState<OptionsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/brands/kia/proforma/options')
      if (!response.ok) throw new Error('Failed to load Kia Proforma options')
      setData(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load options')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, loading, error, reload }
}

function useProformas(mode: string, enabled = true) {
  const [rows, setRows] = useState<KiaProformaRow[]>([])
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalRows: 0 })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [financeStatus, setFinanceStatus] = useState('all')
  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '75', mode })
    if (search) params.set('search', search)
    if (financeStatus !== 'all') params.set('financeStatus', financeStatus)
    try {
      const response = await fetch(`/api/brands/kia/proforma?${params}`)
      if (!response.ok) throw new Error('Failed to load proformas')
      const payload = await response.json()
      setRows(payload.rows || [])
      setPagination(payload.pagination || { page, totalPages: 1, totalRows: 0 })
    } finally {
      setLoading(false)
    }
  }, [enabled, financeStatus, mode, page, search])
  useEffect(() => {
    reload()
  }, [reload])
  return { rows, loading, search, setSearch, page, setPage, pagination, financeStatus, setFinanceStatus, reload }
}

const PROFORMA_NAV_ITEMS: { section: KiaProformaSection; label: string; href: string; approverOnly?: boolean }[] = [
  { section: 'generate', label: 'Generate Proforma', href: '/brands/kia/proforma' },
  { section: 'all', label: 'All Proforma Details', href: '/brands/kia/proforma/all-proforma-details' },
  { section: 'finance-remarks', label: 'Finance Remarks', href: '/brands/kia/proforma/finance-remarks' },
  { section: 'pending-approval', label: 'Pending Approval', href: '/brands/kia/proforma/pending-approval', approverOnly: true },
  { section: 'user-database', label: 'User Database', href: '/brands/kia/proforma/user-database', approverOnly: true },
  { section: 'analytics', label: 'Hyp / Ins Analytics', href: '/brands/kia/proforma/hyp-ins-analytics' },
  { section: 'insights', label: 'Business Insights', href: '/brands/kia/proforma/business-insights' },
]

function ModuleHeader({ section, profile, isApprover }: { section: KiaProformaSection; profile?: KiaProfile | null; isApprover: boolean }) {
  const titles: Record<KiaProformaSection, { title: string; subtitle: string; icon: React.ReactNode }> = {
    generate: { title: 'Generate Proforma', subtitle: 'Create Kia customer proformas with pricing, discounts, and approval queue.', icon: <FileText className="h-5 w-5" /> },
    all: { title: 'All Proforma Details', subtitle: 'Search, filter, audit, and open approved proforma records.', icon: <Columns3 className="h-5 w-5" /> },
    'finance-remarks': { title: 'Finance Remarks', subtitle: 'Update finance status and remarks against every proforma.', icon: <WalletCards className="h-5 w-5" /> },
    'pending-approval': { title: 'Pending Approval', subtitle: 'Verify discounts and cost fields before approval.', icon: <ShieldCheck className="h-5 w-5" /> },
    'user-database': { title: 'User Database', subtitle: 'Manage Kia Proforma user status and approver access.', icon: <UserCog className="h-5 w-5" /> },
    analytics: { title: 'Hyp / Ins Analytics', subtitle: 'Pivot view for bank, insurance, and status performance.', icon: <BarChart3 className="h-5 w-5" /> },
    insights: { title: 'Business Insights', subtitle: 'Operational charts for approvals, status, address integrity, model and fuel mix.', icon: <BarChart3 className="h-5 w-5" /> },
  }
  const current = titles[section]
  return (
    <section className="rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/85 p-5 shadow-xl shadow-slate-900/5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]">
            {current.icon}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--dashboard-action-bg)]">Kia Proforma</p>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">{current.title}</h1>
            <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-600">{current.subtitle}</p>
          </div>
        </div>
        {profile && (
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-right shadow-sm">
            <p className="text-xs font-black text-slate-950">{profile.consultantName}</p>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{profile.dealerLocation || 'AM Kia'} / {profile.employeeCode || 'No emp code'}</p>
          </div>
        )}
      </div>
      <nav className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-2">
        {PROFORMA_NAV_ITEMS
          .filter((item) => !item.approverOnly || isApprover)
          .map((item) => (
            <Link
              key={item.section}
              href={item.href}
              className={cn(
                'shrink-0 rounded-xl border px-4 py-2 text-xs font-black transition-all',
                item.section === section
                  ? proformaPrimaryButton
                  : proformaOutlineButton
              )}
            >
              {item.label}
            </Link>
          ))}
      </nav>
    </section>
  )
}

function GenerateProforma({ options, onSaved }: { options: OptionsPayload; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const editablePrices = form.customerType === 'CSD' || form.customerType === 'Bharat Series'
  const filteredTrims = useMemo(() => {
    return options.trims.filter((trim) => !form.modelName || trim.model === form.modelName).map((trim) => trim.trim_description)
  }, [form.modelName, options.trims])
  const pricing = useMemo(() => {
    return calculateKiaProformaPricing(form, options.prices, options.banks)
  }, [form, options.banks, options.prices])
  const filteredBranches = pricing.branchOptions
  const bankOptions = useMemo(() => getKiaBankOptions(options.banks), [options.banks])
  const prefillExShowroom = pricing.prefill?.exShowroom
  const prefillTcsValue = pricing.prefill?.tcsValue
  const prefillRegistrationCharges = pricing.prefill?.registrationCharges
  const prefillInsuranceValue = pricing.prefill?.insuranceValue
  const prefillFastagValue = pricing.prefill?.fastagValue
  const prefillAccessoriesKit = pricing.prefill?.accessoriesKit
  const prefillExtWarranty = pricing.prefill?.extWarranty
  const prefillInsuranceCompany = pricing.prefill?.insuranceCompany
  const stablePrefill = useMemo(() => (
    prefillExShowroom === undefined
      ? null
      : {
          exShowroom: prefillExShowroom,
          tcsValue: prefillTcsValue || '0',
          registrationCharges: prefillRegistrationCharges || '0',
          insuranceValue: prefillInsuranceValue || '0',
          fastagValue: prefillFastagValue || '0',
          accessoriesKit: prefillAccessoriesKit || '0',
          extWarranty: prefillExtWarranty || '0',
          insuranceCompany: prefillInsuranceCompany || '',
        }
  ), [
    prefillAccessoriesKit,
    prefillExShowroom,
    prefillExtWarranty,
    prefillFastagValue,
    prefillInsuranceCompany,
    prefillInsuranceValue,
    prefillRegistrationCharges,
    prefillTcsValue,
  ])

  useEffect(() => {
    const prefill = stablePrefill
    if (!prefill) return
    setForm((current) => {
      const next = {
        ...current,
        exShowroom: prefill.exShowroom,
        tcsValue: prefill.tcsValue,
        registrationCharges: prefill.registrationCharges,
        insuranceValue: prefill.insuranceValue,
        fastagValue: prefill.fastagValue,
        accessoriesKit: prefill.accessoriesKit,
        extWarranty: prefill.extWarranty,
        insuranceCompany: prefill.insuranceCompany,
      }
      return Object.keys(next).every((key) => next[key as keyof FormState] === current[key as keyof FormState])
        ? current
        : next
    })
  }, [stablePrefill])

  const totals = pricing.totals

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function canonicalizeTrim() {
    setForm((current) => {
      const result = calculateKiaProformaPricing(current, options.prices, options.banks)
      if (!result.canonicalTrim || current.trimDescription === result.canonicalTrim) return current
      return { ...current, trimDescription: result.canonicalTrim, modelName: result.price?.model || current.modelName }
    })
  }

  function canonicalizeBank() {
    setForm((current) => {
      const result = calculateKiaProformaPricing(current, options.prices, options.banks)
      if (!current.bankName.trim()) return current
      if (!result.bankIsValid) return { ...current, bankName: '', bankBranch: '' }
      return {
        ...current,
        bankName: result.canonicalBank,
        bankBranch: result.branchIsValid ? current.bankBranch : '',
      }
    })
  }

  function canonicalizeBranch() {
    setForm((current) => {
      const result = calculateKiaProformaPricing(current, options.prices, options.banks)
      if (!current.bankBranch.trim()) return current
      if (!result.branchIsValid) return { ...current, bankBranch: '' }
      return { ...current, bankBranch: result.canonicalBranch }
    })
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!form.customerName.trim()) next.customerName = 'Customer name is required'
    if (!/^\d{10}$/.test(form.mobileNumber)) next.mobileNumber = 'Mobile number must be 10 digits'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail)) next.customerEmail = 'Valid email is required'
    ;(['customerAddress', 'modelName', 'trimDescription', 'fuelType', 'vehicleColor', 'bankName', 'vehicleStatus'] as (keyof FormState)[]).forEach((key) => {
      if (!String(form[key] || '').trim()) next[key] = 'Required'
    })
    if (form.trimDescription.trim() && !pricing.trimIsValid) next.trimDescription = 'Select a valid trim'
    if (form.bankName.trim() && !pricing.bankIsValid) next.bankName = 'Select a valid bank'
    if (form.bankBranch.trim() && !pricing.branchIsValid) next.bankBranch = 'Select a valid branch for this bank'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSaving(true)
    try {
      const response = await fetch('/api/brands/kia/proforma', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, totalCustomerCost: totals.totalCustomerCost, grandTotalCost: totals.grandTotalCost }),
      })
      if (!response.ok) throw new Error('Failed to save proforma')
      setForm(EMPTY_FORM)
      onSaved()
      alert('Proforma saved and sent to approval queue.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save proforma')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white/88 p-5 shadow-xl shadow-slate-900/5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--dashboard-action-bg)]">Customer Proforma</p>
          <h2 className="text-xl font-black text-slate-950">Pricing and customer details</h2>
        </div>
        <Button onClick={submit} disabled={saving} className={cn('rounded-xl', proformaPrimaryButton)}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Proforma
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        <Field label="Customer Type"><Select value={form.customerType} onValueChange={(value) => update('customerType', value)}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white/90 shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['Customer', 'CSD', 'Bharat Series'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Proforma Date"><TextInput type="date" value={form.proformaDate} onChange={(event) => update('proformaDate', event.target.value)} /></Field>
        <Field label="Customer Name" error={errors.customerName}><TextInput value={form.customerName} onChange={(event) => update('customerName', event.target.value)} /></Field>
        <Field label="Mobile Number" error={errors.mobileNumber}><TextInput inputMode="numeric" maxLength={10} value={form.mobileNumber} onChange={(event) => update('mobileNumber', event.target.value.replace(/\D/g, '').slice(0, 10))} /></Field>
        <Field label="Customer Email" error={errors.customerEmail}><TextInput type="email" value={form.customerEmail} onChange={(event) => update('customerEmail', event.target.value)} /></Field>
        <Field label="Model" error={errors.modelName}><DataListInput listId="kia-models" value={form.modelName} onChange={(value) => { update('modelName', value); update('trimDescription', '') }} options={options.models} /></Field>
        <Field label="Trim" error={errors.trimDescription}><DataListInput listId="kia-trims" value={form.trimDescription} onChange={(value) => update('trimDescription', value)} onBlur={canonicalizeTrim} options={filteredTrims} /></Field>
        <Field label="Fuel Type"><Select value={form.fuelType} onValueChange={(value) => update('fuelType', value)}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white/90 shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['DIESEL', 'PETROL', 'ELECTRIC'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Vehicle Color" error={errors.vehicleColor}><TextInput value={form.vehicleColor} onChange={(event) => update('vehicleColor', event.target.value)} /></Field>
        <Field label="Bank" error={errors.bankName}><DataListInput listId="kia-banks" value={form.bankName} onChange={(value) => setForm((current) => ({ ...current, bankName: value, bankBranch: '' }))} onBlur={canonicalizeBank} options={bankOptions} /></Field>
        <Field label="Bank Branch" error={errors.bankBranch}><DataListInput listId="kia-bank-branches" value={form.bankBranch} onChange={(value) => update('bankBranch', value)} onBlur={canonicalizeBranch} options={filteredBranches} /></Field>
        <Field label="Vehicle Status"><Select value={form.vehicleStatus} onValueChange={(value) => update('vehicleStatus', value)}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white/90 shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['IN HOUSE', 'OUT HOUSE'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Loan Amount"><TextInput type="number" value={form.loanAmount} onChange={(event) => update('loanAmount', event.target.value)} /></Field>
        <Field label="Insurance Company"><DataListInput listId="kia-insurance" value={form.insuranceCompany} onChange={(value) => update('insuranceCompany', value)} options={options.insuranceCompanies} /></Field>
        <div className="md:col-span-2">
          <Field label="Customer Address" error={errors.customerAddress}><Textarea value={form.customerAddress} onChange={(event) => update('customerAddress', event.target.value)} className="min-h-11 rounded-xl border-[var(--dashboard-primary-border)] bg-white/90 font-semibold shadow-sm focus:border-[var(--dashboard-primary-light)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--dashboard-primary-light)_18%,transparent)]" /></Field>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
        <p className="mb-4 text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Price Details {editablePrices ? '(editable)' : '(auto-filled)'}</p>
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ['exShowroom', 'Ex-Showroom'],
            ['tcsValue', 'TCS'],
            ['registrationCharges', 'Registration Charges'],
            ['fastagValue', 'Fastag / Number Plate'],
            ['accessoriesKit', 'Accessories Kit'],
            ['insuranceValue', 'Insurance'],
            ['extWarranty', 'Extended Warranty'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <TextInput type="number" value={form[key as keyof FormState]} disabled={!editablePrices} onChange={(event) => update(key as keyof FormState, event.target.value)} />
            </Field>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white/80 p-4">
        <p className="mb-4 text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Discounts and totals</p>
        <div className="grid gap-4 md:grid-cols-5">
          {[
            ['cashDiscount', 'Cash Discount'],
            ['exchangeValue', 'Exchange'],
            ['bookingAmount', 'Booking Amount'],
            ['govtEmployeeDiscount', 'Govt Employee Discount'],
            ['additionalDiscount', 'Additional Discount'],
          ].map(([key, label]) => (
            <Field key={key} label={label}><TextInput type="number" value={form[key as keyof FormState]} onChange={(event) => update(key as keyof FormState, event.target.value)} /></Field>
          ))}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">To Be Borne By Customer</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{formatCurrency(totals.totalCustomerCost)}</p>
          </div>
          <div className="rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--dashboard-action-bg)]">Grand Total</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{formatCurrency(totals.grandTotalCost)}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function FilterBar({
  rows,
  search,
  setSearch,
  selectedColumn,
  setSelectedColumn,
  selectedValues,
  setSelectedValues,
}: {
  rows: KiaProformaRow[]
  search: string
  setSearch: (value: string) => void
  selectedColumn: string
  setSelectedColumn: (value: string) => void
  selectedValues: Set<string>
  setSelectedValues: (value: Set<string>) => void
}) {
  const values = useMemo(() => {
    if (!selectedColumn) return []
    return Array.from(new Set(rows.map((row) => String(row[selectedColumn as keyof KiaProformaRow] ?? '-')))).sort()
  }, [rows, selectedColumn])
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white/82 p-3 shadow-sm">
      <div className="relative min-w-[260px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, bank, insurance, mobile, branch, model, email..." className="h-11 rounded-2xl border-slate-200 bg-white/80 pl-10 font-semibold" />
      </div>
      <Select value={selectedColumn || 'none'} onValueChange={(value) => { setSelectedColumn(value === 'none' ? '' : value); setSelectedValues(new Set()) }}>
        <SelectTrigger className="h-11 w-56 rounded-2xl bg-white/80"><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="Filter By Column" /></SelectTrigger>
        <SelectContent>{[{ key: 'none', label: 'Filter By Column' }, ...TABLE_COLUMNS.filter((col) => col.key !== 'index')].map((col) => <SelectItem key={String(col.key)} value={String(col.key)}>{col.label}</SelectItem>)}</SelectContent>
      </Select>
      {selectedColumn && (
        <div className="max-h-28 min-w-56 overflow-auto rounded-2xl border border-slate-200 bg-white p-2">
          {values.map((value) => (
            <label key={value} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <Checkbox checked={selectedValues.has(value)} onCheckedChange={(checked) => {
                const next = new Set(selectedValues)
                if (checked) next.add(value)
                else next.delete(value)
                setSelectedValues(next)
              }} />
              {value}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function ProformaTable({
  rows,
  hiddenColumns,
  setHiddenColumns,
  extra,
  action,
}: {
  rows: KiaProformaRow[]
  hiddenColumns: Set<string>
  setHiddenColumns: (value: Set<string>) => void
  extra?: (row: KiaProformaRow) => React.ReactNode
  action?: (row: KiaProformaRow) => React.ReactNode
}) {
  const visibleColumns = TABLE_COLUMNS.filter((column) => !hiddenColumns.has(String(column.key)))
  return (
    <div className="rounded-[1.75rem] border border-slate-200 bg-white/88 shadow-xl shadow-slate-900/5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Proforma Register</p>
        <div className="flex flex-wrap gap-2">
          <Select onValueChange={(value) => {
            const next = new Set(hiddenColumns)
            next.add(value)
            setHiddenColumns(next)
          }}>
            <SelectTrigger className="h-9 w-44 rounded-xl bg-white"><Columns3 className="mr-2 h-4 w-4" /><SelectValue placeholder="Hide column" /></SelectTrigger>
            <SelectContent>{visibleColumns.filter((col) => col.key !== 'index').map((column) => <SelectItem key={String(column.key)} value={String(column.key)}>{column.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" className={cn('h-9 rounded-xl', proformaOutlineButton)} onClick={() => setHiddenColumns(new Set())}><RotateCcw className="mr-2 h-4 w-4" />Restore</Button>
        </div>
      </div>
      <div className="max-h-[620px] overflow-auto">
        <table className="w-max min-w-full table-auto border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-950 text-white">
            <tr>
              {visibleColumns.map((column) => <th key={String(column.key)} className="whitespace-nowrap border-r border-white/15 px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-[0.16em]">{column.label}</th>)}
              {extra && <th className="whitespace-nowrap px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-[0.16em]">Finance</th>}
              {action && <th className="sticky right-0 whitespace-nowrap bg-slate-950 px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-[0.16em]">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={visibleColumns.length + (extra ? 1 : 0) + (action ? 1 : 0)} className="py-16 text-center font-bold text-slate-500">No proformas match this view.</td></tr>
            ) : rows.map((row, index) => (
              <tr key={row.id} className="border-b border-slate-200 align-top hover:bg-slate-50/80">
                {visibleColumns.map((column) => {
                  const raw = column.key === 'index' ? index + 1 : row[column.key]
                  const value = column.numeric ? formatCurrency(raw) : column.key === 'entryTime' ? formatDateTime(String(raw)) : column.key === 'proformaDate' || column.key === 'financeUpdatedTime' ? formatDate(String(raw)) : String(raw ?? '-')
                  return <td key={String(column.key)} className="whitespace-nowrap border-r border-slate-200 px-3 py-2.5 text-xs font-semibold leading-tight text-slate-800">{column.key === 'approvalStatus' ? <Badge className={cn('border', statusClass(row.approvalStatus))}>{row.approvalStatus}</Badge> : value}</td>
                })}
                {extra && <td className="min-w-[320px] border-r border-slate-200 px-3 py-2.5 text-xs">{extra(row)}</td>}
                {action && <td className="sticky right-0 whitespace-nowrap bg-white px-3 py-2.5 text-xs shadow-[-10px_0_18px_rgba(15,23,42,0.04)]">{action(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DetailsView({ options, mode }: { options: OptionsPayload; mode: 'all' | 'finance-remarks' | 'pending-approval' }) {
  const queryMode = mode === 'pending-approval' ? 'pending-approval' : 'all'
  const { rows, loading, search, setSearch, page, setPage, pagination, financeStatus, setFinanceStatus, reload } = useProformas(queryMode, true)
  const [selectedColumn, setSelectedColumn] = useState('')
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set())
  const [hiddenColumns, setHiddenColumnsState] = useState<Set<string>>(() => new Set((options.profile.settings?.kiaProformaHiddenColumns as string[] | undefined) || []))
  const [verifying, setVerifying] = useState<KiaProformaRow | null>(null)
  const [verifyState, setVerifyState] = useState<VerifyState>({})
  const [financeDrafts, setFinanceDrafts] = useState<Record<string, { status: string; remarks: string }>>({})
  const isFinance = mode === 'finance-remarks'

  const filteredRows = useMemo(() => {
    if (!selectedColumn || selectedValues.size === 0) return rows
    return rows.filter((row) => selectedValues.has(String(row[selectedColumn as keyof KiaProformaRow] ?? '-')))
  }, [rows, selectedColumn, selectedValues])

  async function setHiddenColumns(value: Set<string>) {
    setHiddenColumnsState(value)
    await fetch('/api/brands/kia/proforma/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { kiaProformaHiddenColumns: Array.from(value) } }),
    }).catch(() => undefined)
  }

  async function saveFinance(row: KiaProformaRow) {
    const draft = financeDrafts[row.id] || { status: row.financeStatus || 'Pending', remarks: row.financeRemarks || '' }
    const response = await fetch(`/api/brands/kia/proforma/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'finance', financeStatus: draft.status, financeRemarks: draft.remarks }),
    })
    if (!response.ok) return alert('Failed to save finance remarks')
    await reload()
  }

  async function approveCurrent(allApproved = false) {
    if (!verifying) return
    const checks = { ...verifyState }
    if (allApproved) FIELD_VERIFY.forEach(([key]) => { checks[key] = { status: 'APPROVED', reason: '' } })
    const response = await fetch(`/api/brands/kia/proforma/${verifying.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approval', checks }),
    })
    if (!response.ok) return alert('Failed to save approval')
    setVerifying(null)
    setVerifyState({})
    await reload()
  }

  const financeExtra = isFinance ? (row: KiaProformaRow) => {
    const draft = financeDrafts[row.id] || { status: row.financeStatus || 'Pending', remarks: row.financeRemarks || '' }
    return (
      <div className="grid min-w-[420px] gap-2 md:grid-cols-[180px_1fr_auto]">
        <Select value={draft.status} onValueChange={(value) => setFinanceDrafts((current) => ({ ...current, [row.id]: { ...draft, status: value } }))}>
          <SelectTrigger className="h-10 rounded-xl bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>{FINANCE_STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={draft.remarks} onChange={(event) => setFinanceDrafts((current) => ({ ...current, [row.id]: { ...draft, remarks: event.target.value } }))} placeholder="Finance remarks" className="h-10 rounded-xl bg-white" />
        <Button onClick={() => saveFinance(row)} className={cn('h-10 rounded-xl', proformaPrimaryButton)}>Save</Button>
        <p className="md:col-span-3 text-[11px] font-bold text-slate-500">Updated: {formatDateTime(row.financeUpdatedTime)}</p>
      </div>
    )
  } : undefined

  return (
    <div className="space-y-4">
      {isFinance && (
        <div className="flex flex-wrap gap-2">
          {['Pending', 'Cancelled', 'Stock not available', 'Duplicate', 'Current month', 'Converted', 'all'].map((status) => (
            <Button key={status} variant="outline" className={cn('rounded-xl', financeStatus === status ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setFinanceStatus(status)}>
              {status === 'all' ? 'Show All' : status}
            </Button>
          ))}
        </div>
      )}
      <FilterBar rows={rows} search={search} setSearch={setSearch} selectedColumn={selectedColumn} setSelectedColumn={setSelectedColumn} selectedValues={selectedValues} setSelectedValues={setSelectedValues} />
      {loading ? <div className="h-72 animate-pulse rounded-[2rem] bg-white/70" /> : (
        <ProformaTable
          rows={filteredRows}
          hiddenColumns={hiddenColumns}
          setHiddenColumns={setHiddenColumns}
          extra={financeExtra}
          action={(row) => (
            <div className="flex gap-2">
              {mode === 'pending-approval' && <Button className={cn('rounded-xl', proformaPrimaryButton)} onClick={() => setVerifying(row)}>VERIFY</Button>}
              {row.approvalStatus === 'APPROVED' && row.linkPreview && <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} onClick={() => window.open(row.linkPreview!, '_blank')}>Open</Button>}
            </div>
          )}
        />
      )}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/80 p-3">
        <p className="text-sm font-bold text-slate-600">Showing page {pagination.page} of {pagination.totalPages} / {pagination.totalRows} rows</p>
        <div className="flex gap-2">
          <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
          <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <Dialog open={Boolean(verifying)} onOpenChange={(open) => !open && setVerifying(null)}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto rounded-3xl p-0">
          <div className="bg-[var(--dashboard-action-bg)] p-6 text-white">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black">Verify Proforma</DialogTitle>
              <DialogDescription className="text-white/80">{verifying?.customerName} / {verifying?.modelName}</DialogDescription>
            </DialogHeader>
          </div>
          <div className="grid gap-3 p-6">
            {FIELD_VERIFY.map(([key, label]) => (
              <div key={key} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[220px_180px_1fr]">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-black">{formatCurrency(verifying?.[key as keyof KiaProformaRow])}</p>
                </div>
                <Select value={verifyState[key]?.status || 'blank'} onValueChange={(value) => setVerifyState((current) => ({ ...current, [key]: { ...(current[key] || { reason: '' }), status: value === 'blank' ? '' : value } }))}>
                  <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>{['blank', 'APPROVED', 'NOT APPROVED'].map((value) => <SelectItem key={value} value={value}>{value === 'blank' ? 'Blank' : value}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={verifyState[key]?.reason || ''} onChange={(event) => setVerifyState((current) => ({ ...current, [key]: { ...(current[key] || { status: '' }), reason: event.target.value } }))} placeholder="Reason if not approved" className="rounded-xl bg-white" />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} onClick={() => approveCurrent(true)}>Approve All</Button>
              <Button className={cn('rounded-xl', proformaPrimaryButton)} onClick={() => approveCurrent(false)}>Final Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UserDatabase() {
  const [profiles, setProfiles] = useState<KiaProfile[]>([])
  const [stats, setStats] = useState({ active: 0, inactive: 0, new_user: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [approverFilter, setApproverFilter] = useState('all')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/brands/kia/proforma/profiles')
      if (!response.ok) throw new Error('Failed to load user database')
      const payload = await response.json()
      setProfiles(payload.profiles || [])
      setStats(payload.stats || { active: 0, inactive: 0, new_user: 0 })
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { reload() }, [reload])

  const filtered = profiles.filter((profile) => {
    if (statusFilter !== 'all' && profile.status !== statusFilter) return false
    if (approverFilter === 'yes' && !profile.approver) return false
    if (approverFilter === 'no' && profile.approver) return false
    return true
  })

  async function save(profile: KiaProfile, status: string, approver: boolean) {
    const response = await fetch('/api/brands/kia/proforma/profiles', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: profile.id, status, approver }),
    })
    if (!response.ok) return alert('Failed to update user')
    await reload()
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {[['Active', stats.active], ['Inactive', stats.inactive], ['New User', stats.new_user]].map(([label, value]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white/85 p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-black">{Number(value || 0).toLocaleString('en-IN')}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 rounded-3xl border border-slate-200 bg-white/85 p-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-52 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent>{['all', ...Array.from(new Set(profiles.map((p) => p.status)))].map((value) => <SelectItem key={value} value={value}>{value === 'all' ? 'All Status' : value}</SelectItem>)}</SelectContent></Select>
        <Select value={approverFilter} onValueChange={setApproverFilter}><SelectTrigger className="w-52 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Approver</SelectItem><SelectItem value="yes">YES</SelectItem><SelectItem value="no">NO</SelectItem></SelectContent></Select>
      </div>
      <div className="overflow-auto rounded-[1.75rem] border border-slate-200 bg-white/88">
        <table className="w-max min-w-full table-auto text-xs">
          <thead className="bg-slate-950 text-white"><tr>{['Consultant', 'Location', 'Employee Code', 'Status', 'Update Status', 'Approver', 'Action'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest">{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr> : filtered.map((profile) => {
              let status = profile.status
              let approver = profile.approver
              return (
                <tr key={profile.id} className="border-b border-slate-200">
                  <td className="whitespace-nowrap px-3 py-2.5 font-black">{profile.consultantName}<p className="text-[11px] font-semibold text-slate-500">{profile.email}</p></td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{profile.dealerLocation || '-'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{profile.employeeCode || '-'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5"><Badge className={cn('border', profile.status === 'ACTIVE' ? statusClass('approved') : statusClass('pending'))}>{profile.status}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2.5"><Select defaultValue={profile.status} onValueChange={(value) => { status = value }}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['ACTIVE', 'INACTIVE', profile.status].filter((v, i, arr) => arr.indexOf(v) === i).map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></td>
                  <td className="whitespace-nowrap px-3 py-2.5"><Select defaultValue={profile.approver ? 'YES' : 'NO'} onValueChange={(value) => { approver = value === 'YES' }}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="YES">YES</SelectItem><SelectItem value="NO">NO</SelectItem></SelectContent></Select></td>
                  <td className="whitespace-nowrap px-3 py-2.5"><Button className={cn('rounded-xl', proformaPrimaryButton)} onClick={() => save(profile, status, approver)}>Save</Button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AnalyticsView({ insights = false }: { insights?: boolean }) {
  const [type, setType] = useState<'bank' | 'insurance' | 'status'>('bank')
  const [grouping, setGrouping] = useState<'daily' | 'monthly' | 'yearly'>('monthly')
  const [status, setStatus] = useState('all')
  const [top, setTop] = useState<'all' | '5'>('all')
  const [payload, setPayload] = useState<{ pivot: Record<string, unknown>[]; chart: Record<string, unknown>[]; distributions: Record<string, unknown>[] }>({ pivot: [], chart: [], distributions: [] })
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type, grouping, status, top })
      const response = await fetch(`/api/brands/kia/proforma/analytics?${params}`)
      if (!response.ok) throw new Error('Failed to load analytics')
      setPayload(await response.json())
    } finally {
      setLoading(false)
    }
  }, [grouping, status, top, type])
  useEffect(() => { reload() }, [reload])

  const periods = Array.from(new Set(payload.pivot.map((row) => String(row.period)))).sort()
  const categories = Array.from(new Set(payload.pivot.map((row) => String(row.category))))
  const pivotRows = categories.map((category) => {
    const items = payload.pivot.filter((row) => row.category === category)
    const record: Record<string, unknown> = { category, grandTotal: items[0]?.grand_total || 0 }
    periods.forEach((period) => { record[period] = items.find((item) => item.period === period)?.value || 0 })
    return record
  })
  const chartData = periods.map((period) => {
    const record: Record<string, unknown> = { period }
    categories.forEach((category) => {
      record[category] = payload.chart.find((row) => row.period === period && row.category === category)?.value || 0
    })
    return record
  })
  const approvalTotals = payload.distributions.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.approval_status || 'Pending')
    acc[key] = (acc[key] || 0) + Number(row.total || 0)
    return acc
  }, {})
  const approvalDist = Object.entries(approvalTotals).map(([name, value]) => ({ name, value: Number(value) }))
  const statusTotals = payload.distributions.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.vehicle_status || 'Unknown')
    acc[key] = (acc[key] || 0) + Number(row.total || 0)
    return acc
  }, {})
  const statusDist = Object.entries(statusTotals).map(([name, value]) => ({ name, value: Number(value) }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-3xl border border-slate-200 bg-white/85 p-3">
        <Select value={type} onValueChange={(value: 'bank' | 'insurance' | 'status') => setType(value)}><SelectTrigger className="w-56 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank">By Bank Name</SelectItem><SelectItem value="insurance">By Insurance Company</SelectItem>{!insights && <SelectItem value="status">By Status</SelectItem>}</SelectContent></Select>
        <Select value={grouping} onValueChange={(value: 'daily' | 'monthly' | 'yearly') => setGrouping(value)}><SelectTrigger className="w-44 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select>
        {!insights && <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="IN HOUSE">In House</SelectItem><SelectItem value="OUT HOUSE">Out House</SelectItem></SelectContent></Select>}
        <Button variant="outline" className={cn('rounded-xl', top === 'all' ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setTop('all')}>All</Button>
        <Button variant="outline" className={cn('rounded-xl', top === '5' ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setTop('5')}>TOP 5</Button>
      </div>
      {loading ? <div className="h-80 animate-pulse rounded-[2rem] bg-white/70" /> : insights ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Category trend">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis /><Tooltip /><Legend />{categories.map((category, index) => <Bar key={category} dataKey={category} stackId="a" fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <PieCard title="Approval status distribution" data={approvalDist} />
          <PieCard title="In House vs Out House" data={statusDist} />
          <PieCard title="Customer address integrity" data={[{ name: 'Address Captured', value: 1 }]} />
        </div>
      ) : (
        <div className="overflow-auto rounded-[1.75rem] border border-slate-200 bg-white/88">
          <table className="w-max min-w-full table-auto text-xs">
            <thead className="bg-slate-950 text-white"><tr><th className="whitespace-nowrap px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest">Category</th>{periods.map((period) => <th key={period} className="whitespace-nowrap px-3 py-2.5 text-right text-[9px] font-black uppercase tracking-widest">{period}</th>)}<th className="whitespace-nowrap px-3 py-2.5 text-right text-[9px] font-black uppercase tracking-widest">Grand Total</th></tr></thead>
            <tbody>
              {pivotRows.map((row) => <tr key={String(row.category)} className="border-b border-slate-200"><td className="whitespace-nowrap px-3 py-2.5 font-black">{String(row.category)}</td>{periods.map((period) => <td key={period} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{Number(row[period] || 0).toLocaleString('en-IN')}</td>)}<td className="whitespace-nowrap px-3 py-2.5 text-right font-black">{Number(row.grandTotal || 0).toLocaleString('en-IN')}</td></tr>)}
              <tr className="bg-slate-100 font-black"><td className="whitespace-nowrap px-3 py-2.5">Grand Total</td>{periods.map((period) => <td key={period} className="whitespace-nowrap px-3 py-2.5 text-right">{pivotRows.reduce((sum, row) => sum + Number(row[period] || 0), 0).toLocaleString('en-IN')}</td>)}<td className="whitespace-nowrap px-3 py-2.5 text-right">{pivotRows.reduce((sum, row) => sum + Number(row.grandTotal || 0), 0).toLocaleString('en-IN')}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-[1.75rem] border border-slate-200 bg-white/88 p-4 shadow-sm"><p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{title}</p>{children}</div>
}

function PieCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} label>{data.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function KiaProformaPage({ section }: { section: KiaProformaSection }) {
  const { data: options, loading, error, reload } = useOptions()
  const approverOnly = section === 'pending-approval' || section === 'user-database'
  if (loading) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="space-y-4"><div className="h-32 animate-pulse rounded-[2rem] bg-white/70" /><div className="h-96 animate-pulse rounded-[2rem] bg-white/70" /></div></MainLayout>
  }
  if (error || !options) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 font-bold text-rose-700">{error || 'Unable to load Kia Proforma.'}</div></MainLayout>
  }
  if (approverOnly && !options.currentUser.isApprover) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6"><h1 className="text-2xl font-black">Access required</h1><p className="mt-2 font-semibold text-amber-800">This page is available only for Kia Proforma approvers or manager roles.</p></div></MainLayout>
  }

  return (
    <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system">
      <div className="space-y-5">
        <ModuleHeader section={section} profile={options.profile} isApprover={options.currentUser.isApprover} />
        {section === 'generate' && <GenerateProforma options={options} onSaved={reload} />}
        {section === 'all' && <DetailsView options={options} mode="all" />}
        {section === 'finance-remarks' && <DetailsView options={options} mode="finance-remarks" />}
        {section === 'pending-approval' && <DetailsView options={options} mode="pending-approval" />}
        {section === 'user-database' && <UserDatabase />}
        {section === 'analytics' && <AnalyticsView />}
        {section === 'insights' && <AnalyticsView insights />}
      </div>
    </MainLayout>
  )
}
