'use client'

/**
 * AM Group — public approvals submit form (all brands).
 *
 * THESIS: this is a payment voucher being drafted, not a wall of inputs. The submitter is asking
 * for money and has no login, no dashboard, and no way to check what they sent. So the form always
 * shows the request taking shape beside the fields. It refuses the category default of one long
 * undifferentiated card of identical rounded boxes.
 *
 * OWN-WORLD: slate ground, white paper, and the product's tropical-teal accent carrying every
 * active surface — masthead, section marks, primary actions, focus and selection. Colour comes
 * from the `--dashboard-*` theme tokens, never a literal hex. A teal masthead the paper overlaps,
 * so the page has an anchor instead of floating. One sans, a real type scale, no uppercase
 * micro-labels.
 *
 * STORY: the submitter fills four short sections; the docket beside them (or under their thumb on
 * a phone) keeps the amount, the payee and the attachment count visible, so they submit knowing
 * exactly what goes to Accounts.
 *
 * FIRST VIEWPORT: masthead with brand mark and title; the paper rises into it carrying Requester
 * Profile; the docket sits right, amount in large tabular numerals.
 *
 * FORM: Operate mode inside an established world — visual system fixed, structure replaced.
 */

import { useState, FormEvent, ChangeEvent, DragEvent, useEffect, useMemo, useRef } from 'react'
import { 
  FileText, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  MapPin, 
  Building2, 
  User, 
  Mail, 
  PlusCircle, 
  Info,
  IndianRupee,
  FileCheck,
  Plus,
  AlertTriangle,
  Calculator,
  Tags,
  Hash,
  X,
  ChevronDown,
  Check,
  Paperclip,
  ShieldCheck
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { validateEmailDomain } from '@/lib/email-validator'
import { findMissingApprovalField } from '@/lib/approvals/required-fields'
import { amountInWordsINR } from '@/lib/kia/print-payment-order'
import { cn } from '@/lib/utils'

/* ---------------------------------------------------------------------------------------------
 * Shared field vocabulary. Every control on this form is built from these three strings, so a
 * select can never drift from an input again — the incumbent shipped `appearance-none` selects
 * with no replacement chevron, which rendered three dropdowns with no arrow at all.
 * ------------------------------------------------------------------------------------------- */

/**
 * No font-size here on purpose. Tailwind resolves `text-sm` vs `text-2xl` by stylesheet order, not
 * by the order they appear in the class attribute, so baking a size into the shared base silently
 * beat the larger size on the amount field. Each control states its own size.
 */
const CONTROL_BASE =
  'w-full rounded-xl border border-slate-200 bg-white font-medium text-slate-900 shadow-sm transition duration-150 placeholder:font-normal placeholder:text-slate-500 focus:border-[color:var(--dashboard-primary)] focus:outline-none focus:ring-4 focus:ring-[color:rgba(var(--dashboard-primary-rgb),0.12)]'

const INPUT_CLASS = `${CONTROL_BASE} h-12 px-4 text-sm`

const SELECT_CLASS = `${CONTROL_BASE} h-12 cursor-pointer appearance-none pl-4 pr-11 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500`

/** Select wrapper that guarantees the chevron the incumbent forgot. */
function SelectShell({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2',
          disabled ? 'text-slate-300' : 'text-slate-400'
        )}
      />
    </div>
  )
}

/** Label + control. Wrapping in <label> associates them without needing an id on every field. */
function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string
  required?: boolean
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] font-semibold text-slate-700">
        {label}
        {/* No asterisks: nearly every field here is required, so the handful that aren't carry an
            "optional" hint instead. The docket also names anything still missing. */}
        {!required && !hint && <span className="text-xs font-normal text-slate-500">optional</span>}
        {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/**
 * Same visual contract as Field, but a <div> — for controls that own their own focus management
 * (the vendor combobox, the upload slots), where a wrapping label would steal the click.
 */
function FieldBlock({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string
  required?: boolean
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('block', className)}>
      <span className="mb-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] font-semibold text-slate-700">
        {label}
        {/* No asterisks: nearly every field here is required, so the handful that aren't carry an
            "optional" hint instead. The docket also names anything still missing. */}
        {!required && !hint && <span className="text-xs font-normal text-slate-500">optional</span>}
        {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </div>
  )
}

/** A titled step of the form. The tick is state, not decoration: it tracks required fields. */
function Section({
  icon: Icon,
  title,
  description,
  complete,
  children,
}: {
  icon: typeof User
  title: string
  description: string
  complete: boolean
  children: React.ReactNode
}) {
  return (
    <section className="scroll-mt-8">
      <div className="mb-6 flex items-start gap-3.5">
        <div
          className={cn(
            'mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl transition-colors duration-200',
            complete ? 'bg-emerald-600 text-white' : 'bg-[var(--dashboard-primary)] text-white'
          )}
        >
          {complete ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>
        </div>
      </div>
      <div className="pl-0 sm:pl-[3.125rem]">{children}</div>
    </section>
  )
}

/** One line of the docket. */
function DocketRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="flex-none text-xs font-medium text-slate-500">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right text-[13px] font-medium',
          value ? 'text-slate-900' : 'text-slate-500'
        )}
      >
        {value || 'Not set'}
      </dd>
    </div>
  )
}

// Category/Approval Type to GL Code mapping
const APPROVAL_TYPE_TO_GL_CODE: Record<string, string> = {
  'Accessories Purchase': 'GL-017',
  'Advance Against Salary': 'GL-080',
  'Card Payment': 'GL-065',
  'Corporate Card Payment': 'GL-065',
  'Event': 'GL-033',
  'Promotion': 'GL-033',
  'Event / Promotion / Advertising': 'GL-033',
  'Fuel Filling': 'GL-047',
  'Fund Transfer': 'GL-079',
  'Fund Transfer (OEM / EW / Wallet)': 'GL-079',
  'House Keeping': 'GL-043',
  'Housekeeping': 'GL-043',
  'Incentive Disbursement': 'GL-025',
  'Maintenance': 'GL-039',
  'Maintenance & Repair': 'GL-039',
  'Others': 'GL-061',
  'Scope Gainer': 'GL-061',
  'Local Vendor': 'GL-061',
  'Pantry Items': 'GL-029',
  'Pantry / Refreshment': 'GL-029',
  'Petty Cash': 'GL-083',
  'Cash': 'GL-083',
  'Rent': 'GL-037',
  'Rents': 'GL-037',
  'Salary Disbursement': 'GL-024',
  'Releasing Hold Salary / Incentive': 'GL-024',
  'Spare Parts Purchase': 'GL-015',
  'Part Purchase': 'GL-015',
  'Purchase': 'GL-015',
  'Part Purchasing From Other Dealer': 'GL-016',
  'Staff Uniform': 'GL-027',
  'Uniform': 'GL-027',
  'Staff Welfare': 'GL-026',
  'Training Expenses': 'GL-028',
  'Travelling Charges': 'GL-052',
  'Travelling & Conveyance': 'GL-052',
  'Utility & Subscription': 'GL-055',
  'Vehicle Stock Transfer': 'GL-013',
  'Stock Transfer': 'GL-013',
  'Vendor Payment': 'GL-068',
  'Vendor Payment (Bill / Invoice)': 'GL-068',
  'Workshop / Job Work (Sublet)': 'GL-021',
  'Labour Payment': 'GL-021',
  'Freight & Courier': 'GL-050',
  'Fast Tag': 'GL-051',
  'PF': 'GL-030',
  'ESIC': 'GL-031',
  'RTO': 'GL-060',
  'Statutory Payment (PF / ESIC / GST / RTO)': 'GL-060',
  'Professional Fee': 'GL-057',
  'Driver Expenses': 'GL-052',
  'Driver Expense': 'GL-052',
  'Crane Charges': 'GL-052',
  'Key Cutting': 'GL-039',
  'Tyre fitting / Puncture': 'GL-039',
}

// GL Code to Vendor suggestions mapping
const GL_CODE_TO_VENDORS: Record<string, string[]> = {
  'GL-032': ['Creative Shadows', 'APK Advertiser', 'Chander Bhaga', 'Daily Excelsior', 'Hyperlocal', 'Havas', 'Radio Mirchi'],
  'GL-045': ['BD Security', 'Franknight', 'Kapahi Hawkeye', 'GDX Security'],
  'GL-055': ['Airtel', 'BSNL', 'Jio', 'Interakt'],
  'GL-036': ['Interakt'],
  'GL-044': ['Mahaveer Pest Control']
}

// Vendor search keyword to GL Code auto-select mapping
const VENDOR_TO_GL_CODE: Record<string, string> = {
  'mahaveer pest control': 'GL-044',
  'airtel': 'GL-055',
  'bsnl': 'GL-055',
  'jio': 'GL-055',
  'interakt': 'GL-036',
  'creative shadows': 'GL-032',
  'apk advertiser': 'GL-032',
  'chander bhaga': 'GL-032',
  'daily excelsior': 'GL-032',
  'hyperlocal': 'GL-032',
  'havas': 'GL-032',
  'radio mirchi': 'GL-032',
  'bd security': 'GL-045',
  'franknight': 'GL-045',
  'kapahi hawkeye': 'GL-045',
  'gdx security': 'GL-045'
}

// Options from constants that remain static across all forms
const DEPARTMENT_OPTIONS = [
  'HR',
  'ADMIN',
  'SALES',
  'SERVICE',
  'HP ROMISE',
  'BODY SHOP',
  'ACCOUNTS',
  'CRM',
  'INSURANCE',
  'EDP / IT',
  'SPARE PARTS',
  'SALES & SERVICE',
  'Accessories',
  'EMI',
  'NEW JOINING',
  'LABOUR CHARGES',
  'OTHER',
]

const DEFAULT_APPROVAL_TYPES = [
  'Crane Charges',
  'Key Cutting',
  'Tyre fitting / Puncture',
  'Accessories Purchase',
  'Advance Against Salary',
  'Card Payment',
  'Corporate Card Payment',
  'Driver Expenses',
  'Event / Promotion / Advertising',
  'Fast Tag',
  'Freight & Courier',
  'Fuel Filling',
  'Fund Transfer (OEM / EW / Wallet)',
  'House Keeping',
  'Incentive Disbursement',
  'Labour Payment',
  'Maintenance & Repair',
  'Marketing & Promotions',
  'Office Supplies & Stationery',
  'Pantry / Refreshment',
  'Part Purchase',
  'Part Purchasing From Other Dealer',
  'Professional Fee',
  'Rent',
  'Salary Disbursement',
  'Spare Parts Purchase',
  'Staff Uniform',
  'Staff Welfare',
  'Statutory Payment (PF / ESIC / GST / RTO)',
  'Training Expenses',
  'Travelling & Conveyance',
  'Utility & Subscription',
  'Vehicle Stock Transfer',
  'Vendor Payment (Bill / Invoice)',
  'Workshop / Job Work (Sublet)',
  'Others',
]

const DEFAULT_LOCATIONS_BY_BRAND: Record<string, Array<{ location: string; dealerCode: string; dealerName: string }>> = {
  kia: [
    { location: 'Jammu', dealerCode: 'KIA-JM', dealerName: 'AM Kia Jammu' },
    { location: 'Udhampur', dealerCode: 'KIA-UD', dealerName: 'AM Kia Udhampur' },
    { location: 'Banihal', dealerCode: 'KIA-BN', dealerName: 'AM Kia Banihal' },
  ],
  hyundai: [
    { location: 'Jammu', dealerCode: 'HYU-JM', dealerName: 'AM Hyundai Jammu' },
    { location: 'Akhnoor', dealerCode: 'HYU-AK', dealerName: 'AM Hyundai Akhnoor' },
    { location: 'Kathua', dealerCode: 'HYU-KT', dealerName: 'AM Hyundai Kathua' },
    { location: 'RS Pura', dealerCode: 'HYU-RS', dealerName: 'AM Hyundai RS Pura' },
    { location: 'Vijaypur', dealerCode: 'HYU-VJ', dealerName: 'AM Hyundai Vijaypur' },
    { location: 'Billawar', dealerCode: 'HYU-BL', dealerName: 'AM Hyundai Billawar' },
  ],
  platinum: [
    { location: 'Jammu', dealerCode: 'PLT-JM', dealerName: 'AM Platinum Jammu' },
    { location: 'Kathua', dealerCode: 'PLT-KT', dealerName: 'AM Platinum Kathua' },
    { location: 'Udhampur', dealerCode: 'PLT-UD', dealerName: 'AM Platinum Udhampur' },
  ],
  mg: [
    { location: 'Jammu', dealerCode: 'MG-JM', dealerName: 'AM MG Jammu' },
    { location: 'Srinagar', dealerCode: 'MG-SR', dealerName: 'AM MG Srinagar' },
  ],
  tata: [
    { location: 'Jammu', dealerCode: 'TAT-JM', dealerName: 'AM Tata Jammu' },
  ],
}

const PAYMENT_TYPE_OPTIONS = [
  'CREDIT',
  'CASH',
  'CHEQUE',
  'ONLINE TRANSFER',
  'Credit Card'
]

interface FormState {
  email: string
  name: string
  location: string
  dealerCode: string
  dealerName: string
  department: string
  specifyOtherDepartment: string
  approvalType: string
  vendorName: string
  specifyOtherApprovalType: string
  previousAdvance: string
  amount: string
  typeOfPayment: string
  remarks: string
  /** Ordered list of uploaded bill URLs. One control, any number of bills. */
  billUrls: string[]
  uploadDocUrl: string
  glAccountId: string
  gst: string
  vehicleNumber: string
}

/**
 * Per-slot upload state.
 *
 * `previewUrl` is an object URL for image picks — it is created on select and MUST be revoked on
 * replace/remove/unmount, otherwise the blob is pinned for the life of the tab.
 * `progress` is a real 0-100 from the XHR upload event, not a fake ticker.
 */
interface UploadSlotState {
  name: string
  size: number
  kind: 'image' | 'pdf' | null
  previewUrl: string
  loading: boolean
  progress: number
  error: string
}

interface UploadState {
  doc: UploadSlotState
}

/**
 * One bill in the multi-file bill upload. Each uploads independently, so a slow fifth bill never
 * blocks the first four, and one failure never discards the rest.
 */
interface BillItem {
  id: string
  name: string
  size: number
  kind: 'image' | 'pdf'
  previewUrl: string
  loading: boolean
  progress: number
  error: string
  /**
   * Whether Retry can do anything. False for files rejected on type/size — the file was never
   * kept, so offering Retry would be a button that silently does nothing.
   */
  canRetry: boolean
  /** Set once the upload lands; only items with a url are submitted. */
  url: string
}

const EMPTY_UPLOAD_SLOT: UploadSlotState = {
  name: '',
  size: 0,
  kind: null,
  previewUrl: '',
  loading: false,
  progress: 0,
  error: '',
}

// Mirrors the server cap in app/api/brands/kia/approvals/upload/route.ts — rejecting here saves the
// submitter a 15MB round trip that always ends in a 400.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const ACCEPTED_UPLOAD_TYPES = 'image/*,application/pdf'

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface VendorOption {
  id: string
  name: string
  gstNumber: string | null
}

interface LocationConfig {
  location: string
  dealerCode: string
  dealerName: string
}

/**
 * One upload slot (Bill 1 / Bill 2 / Documents).
 *
 * Deliberately NOT a <label> wrapper: the remove/replace controls sit inside the drop target, and a
 * nested button inside a label re-opens the file picker on click. Instead the empty state uses a
 * full-bleed <button>, which also gives keyboard access for free.
 *
 * Every button here is type="button" — this renders inside the submit <form>, so the default
 * type="submit" would fire a submission on click.
 */
function UploadSlot({
  label,
  state,
  url,
  onSelect,
  onRemove,
}: {
  label: string
  state: UploadSlotState
  url: string
  onSelect: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // dragenter/dragleave fire for every child element crossed; a depth counter stops the flicker.
  const dragDepth = useRef(0)

  const openPicker = () => inputRef.current?.click()

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onSelect(file)
    // Reset so picking the SAME file again after a remove still fires onChange.
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onSelect(file)
  }

  const attached = Boolean(url) && !state.loading
  const hasError = Boolean(state.error)

  return (
    <div>
      <span className="mb-2 block text-[13px] font-semibold text-slate-700">{label}</span>

      <div
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault()
          dragDepth.current -= 1
          if (dragDepth.current <= 0) {
            dragDepth.current = 0
            setDragging(false)
          }
        }}
        onDrop={handleDrop}
        className={cn(
          'relative flex h-36 flex-col items-center justify-center rounded-xl border border-dashed transition duration-150',
          dragging && 'border-[color:var(--dashboard-primary)] bg-[rgba(var(--dashboard-primary-rgb),0.06)] ring-4 ring-[color:rgba(var(--dashboard-primary-rgb),0.12)]',
          !dragging && hasError && 'border-rose-300 bg-rose-50/50',
          !dragging && !hasError && attached && 'border-emerald-300 bg-emerald-50/40',
          !dragging && !hasError && !attached && 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_UPLOAD_TYPES}
          onChange={handleInputChange}
          className="hidden"
        />

        {state.loading ? (
          /* ---- Uploading: real progress, not a spinner ---- */
          <div className="flex w-full flex-col items-center gap-2 px-4" aria-busy="true">
            {state.previewUrl ? (
              // next/image cannot load a blob: object URL — this is a purely local preview of the
              // file being uploaded, never a network image, so there is nothing to optimize.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.previewUrl}
                alt=""
                className="h-10 w-10 rounded-lg object-cover opacity-50"
              />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            )}
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[var(--dashboard-primary)] transition-[width] duration-200 ease-out"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums text-slate-500">
              Uploading {state.progress}%
            </span>
          </div>
        ) : attached ? (
          /* ---- Attached: thumbnail / icon, name, size, view + remove ---- */
          <div className="flex w-full flex-col items-center gap-1.5 px-3">
            {state.kind === 'image' && state.previewUrl ? (
              // Local blob: preview — see note above.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.previewUrl}
                alt={state.name || 'Uploaded file preview'}
                className="h-12 w-12 rounded-lg border border-emerald-200 object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-200 bg-white">
                <FileCheck className="h-6 w-6 text-emerald-600" />
              </div>
            )}

            <span className="max-w-full truncate text-[13px] font-medium text-slate-900">
              {state.name || 'Attached'}
            </span>
            {state.size > 0 && (
              <span className="text-xs tabular-nums text-slate-500">{formatBytes(state.size)}</span>
            )}

            <div className="flex items-center gap-0.5">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded px-2 py-2 text-xs font-medium text-[color:var(--dashboard-primary)] hover:text-[color:var(--dashboard-action-hover)] hover:underline"
              >
                View
              </a>
              <button
                type="button"
                onClick={openPicker}
                className="rounded px-2 py-2 text-xs font-medium text-[color:var(--dashboard-primary)] hover:text-[color:var(--dashboard-action-hover)] hover:underline"
              >
                Replace
              </button>
            </div>

            {/* 44px tap target (WCAG 2.5.5) with a smaller visual circle inside, so the hit area is
                thumb-sized without a chunky button dominating the card. */}
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${state.name || label}`}
              className="group absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:rgba(var(--dashboard-primary-rgb),0.22)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors group-hover:bg-white group-hover:text-red-600">
                <X className="h-4 w-4" />
              </span>
            </button>
          </div>
        ) : (
          /* ---- Empty (or errored): full-bleed picker button ---- */
          <button
            type="button"
            onClick={openPicker}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl px-3 text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:rgba(var(--dashboard-primary-rgb),0.22)]"
          >
            {hasError ? (
              <AlertCircle className="h-5 w-5 text-rose-500" />
            ) : (
              <Upload className="h-5 w-5 text-slate-400" />
            )}
            <span
              className={cn(
                'text-[13px] font-medium',
                hasError ? 'text-rose-700' : 'text-slate-700'
              )}
            >
              {hasError ? 'Try again' : 'Drop file or browse'}
            </span>
            <span className="text-xs text-slate-500">PDF, JPG or PNG · up to 15MB</span>
          </button>
        )}
      </div>

      {hasError && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-rose-700">
          {state.error}
        </p>
      )}
    </div>
  )
}

/**
 * The bill upload: ONE drop target that takes as many bills as the request needs.
 *
 * Replaces the old pair of fixed "Bill 1" / "Bill 2" slots — submitters routinely have three or
 * more bills for a single payment and had nowhere to put the rest.
 */
function BillsUpload({
  items,
  onAdd,
  onRemove,
  onRetry,
}: {
  items: BillItem[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const openPicker = () => inputRef.current?.click()

  const uploaded = items.filter(i => i.url).length

  return (
    <div>
      <span className="mb-2 flex items-baseline gap-1.5 text-[13px] font-semibold text-slate-700">
        Bills
        {items.length > 0 && (
          <span className="text-xs font-normal tabular-nums text-slate-500">
            {uploaded} of {items.length} uploaded
          </span>
        )}
      </span>

      <div
        onDragEnter={e => {
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={e => e.preventDefault()}
        onDragLeave={e => {
          e.preventDefault()
          dragDepth.current -= 1
          if (dragDepth.current <= 0) {
            dragDepth.current = 0
            setDragging(false)
          }
        }}
        onDrop={e => {
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          const files = Array.from(e.dataTransfer.files || [])
          if (files.length) onAdd(files)
        }}
        className={cn(
          'relative rounded-xl border border-dashed transition duration-150',
          dragging
            ? 'border-[color:var(--dashboard-primary)] bg-[rgba(var(--dashboard-primary-rgb),0.06)] ring-4 ring-[color:rgba(var(--dashboard-primary-rgb),0.12)]'
            : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_UPLOAD_TYPES}
          onChange={e => {
            const files = Array.from(e.target.files || [])
            if (files.length) onAdd(files)
            // Reset so re-picking the same file after a remove still fires onChange.
            e.target.value = ''
          }}
          className="hidden"
        />

        <button
          type="button"
          onClick={openPicker}
          className="flex w-full flex-col items-center justify-center gap-1.5 px-4 py-8 text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:rgba(var(--dashboard-primary-rgb),0.22)]"
        >
          <Upload className="h-5 w-5 text-slate-400" />
          <span className="text-[13px] font-medium text-slate-700">
            {items.length ? 'Add more bills' : 'Drop bills here or browse'}
          </span>
          <span className="text-xs text-slate-500">
            PDF, JPG or PNG · up to 15MB each · attach as many as you need
          </span>
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map(item => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border bg-white p-2.5 pr-1.5',
                item.error ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'
              )}
            >
              {item.kind === 'image' && item.previewUrl ? (
                // Local blob: preview — next/image cannot load an object URL.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className={cn(
                    'h-10 w-10 flex-none rounded-lg border border-slate-200 object-cover',
                    item.loading && 'opacity-50'
                  )}
                />
              ) : (
                <div
                  className={cn(
                    'flex h-10 w-10 flex-none items-center justify-center rounded-lg border',
                    item.error
                      ? 'border-rose-200 bg-white text-rose-500'
                      : item.url
                        ? 'border-emerald-200 bg-white text-emerald-600'
                        : 'border-slate-200 bg-white text-slate-400'
                  )}
                >
                  {item.error ? (
                    <AlertCircle className="h-5 w-5" />
                  ) : (
                    <FileCheck className="h-5 w-5" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-900">{item.name}</p>

                {item.loading ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-[var(--dashboard-primary)] transition-[width] duration-200 ease-out"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <span className="flex-none text-xs tabular-nums text-slate-500">
                      {item.progress}%
                    </span>
                  </div>
                ) : item.error ? (
                  <p role="alert" className="mt-0.5 text-xs font-medium text-rose-700">
                    {item.error}
                    {item.canRetry && (
                      <>
                        {' '}
                        <button
                          type="button"
                          onClick={() => onRetry(item.id)}
                          className="underline underline-offset-2 hover:text-rose-900"
                        >
                          Retry
                        </button>
                      </>
                    )}
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="tabular-nums">{formatBytes(item.size)}</span>
                    {item.url && (
                      <>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="-my-1 rounded px-1 py-1 font-medium text-[color:var(--dashboard-primary)] hover:text-[color:var(--dashboard-action-hover)] hover:underline"
                        >
                          View
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.name}`}
                className="group flex h-11 w-11 flex-none items-center justify-center rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:rgba(var(--dashboard-primary-rgb),0.22)]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors group-hover:bg-slate-100 group-hover:text-rose-600">
                  <X className="h-4 w-4" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ApprovalsSubmitForm({ brand }: { brand: string }) {
  const [form, setForm] = useState<FormState>({
    email: '',
    name: '',
    location: '',
    dealerCode: '',
    dealerName: '',
    department: '',
    specifyOtherDepartment: '',
    approvalType: '',
    vendorName: '',
    specifyOtherApprovalType: '',
    previousAdvance: '',
    amount: '',
    typeOfPayment: '',
    remarks: '',
    billUrls: [],
    uploadDocUrl: '',
    glAccountId: '',
    gst: '',
    vehicleNumber: ''
  })


  /**
   * Re-submit: hydrate the form from a send-back email link.
   *
   * The submitter has no dashboard login, so the `resubmit` param is a SIGNED TOKEN, not a row id
   * — the endpoint verifies the signature and returns an allowlist of the fields they originally
   * typed. Approval history, approver remarks and payment details are never returned.
   *
   * The token is carried into the POST so the server updates the ORIGINAL row and appends a
   * "resubmitted" history entry, rather than creating a second request the approvers have to
   * reconcile against the first.
   */
  /**
   * This form is public and renders without the dashboard header, so the accent switcher never
   * runs here and `--dashboard-primary` would resolve to the default indigo. Opt the document into
   * the tropical-teal token set instead of hardcoding #055B65 — that hex IS the teal theme, and
   * writing it literally pins the page to one theme forever.
   *
   * The previous value is restored on unmount so a logged-in user who opens the form and navigates
   * back to the dashboard doesn't carry teal with them.
   */
  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute('data-dashboard-accent')
    root.setAttribute('data-dashboard-accent', 'tropical-teal')
    return () => {
      if (previous === null) root.removeAttribute('data-dashboard-accent')
      else root.setAttribute('data-dashboard-accent', previous)
    }
  }, [])

  // Declared above the re-submit effect below, which hydrates it from the send-back link.
  const [bills, setBills] = useState<BillItem[]>([])
  // Keyed by BillItem id, same lifetime rules as the single-slot previews.
  const billPreviewsRef = useRef<Record<string, string>>({})

  const [resubmitId, setResubmitId] = useState<string | null>(null)
  // The raw signed token, kept so the POST can prove it may update the original row — the create
  // endpoint is unauthenticated, so the token (not the id) is the credential there too.
  const [resubmitToken, setResubmitToken] = useState<string | null>(null)
  const [resubmitReason, setResubmitReason] = useState<string | null>(null)
  const [resubmitError, setResubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = new URLSearchParams(window.location.search).get('resubmit')
    if (!token) return

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/brands/${brand}/approvals/resubmit?token=${encodeURIComponent(token)}`)
        const payload = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setResubmitError(payload.error || 'This re-submit link could not be opened.')
          return
        }
        const prefill = (payload.prefill || {}) as Record<string, unknown>
        const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))
        setForm((previous) => ({
          ...previous,
          email: text(prefill.email) || previous.email,
          name: text(prefill.name) || previous.name,
          location: text(prefill.location) || previous.location,
          dealerCode: text(prefill.dealerCode) || previous.dealerCode,
          dealerName: text(prefill.dealerName) || previous.dealerName,
          department: text(prefill.department) || previous.department,
          specifyOtherDepartment: text(prefill.specifyOtherDepartment),
          approvalType: text(prefill.approvalType) || previous.approvalType,
          vendorName: text(prefill.vendorName) || previous.vendorName,
          specifyOtherApprovalType: text(prefill.specifyOtherApprovalType),
          previousAdvance: text(prefill.previousAdvance),
          amount: text(prefill.amount),
          typeOfPayment: text(prefill.typeOfPayment),
          remarks: text(prefill.remarks),
          uploadDocUrl: text(prefill.uploadDocUrl),
          glAccountId: text(prefill.glAccountId),
          gst: text(prefill.gst),
          vehicleNumber: text(prefill.vehicleNumber),
        }))

        // Re-hydrate the bills they already attached, so a send-back doesn't cost them every
        // upload. These have a url but no local File — remove works, retry is not offered.
        const priorBills = Array.isArray(prefill.billUrls) ? (prefill.billUrls as unknown[]) : []
        setBills(
          priorBills
            .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
            .map((url, index) => ({
              id: `prior-${index}`,
              name: `Bill ${index + 1}`,
              size: 0,
              kind: /\.pdf($|\?)/i.test(url) ? 'pdf' : 'image',
              previewUrl: '',
              loading: false,
              progress: 100,
              error: '',
              // No local File behind these — they came back from the send-back link, not a picker.
              canRetry: false,
              url,
            }))
        )
        setResubmitId(text(prefill.id) || null)
        setResubmitToken(token)
        setResubmitReason(payload.sendBackReason || null)
      } catch {
        if (!cancelled) setResubmitError('This re-submit link could not be opened.')
      }
    })()
    return () => { cancelled = true }
  }, [brand])

  const [uploads, setUploads] = useState<UploadState>(() => ({
    doc: { ...EMPTY_UPLOAD_SLOT },
  }))

  useEffect(() => {
    const urls = billPreviewsRef.current
    return () => {
      Object.values(urls).forEach(u => URL.revokeObjectURL(u))
    }
  }, [])

  // Object URLs outlive React state, so keep a ref of the live ones and revoke on unmount.
  const previewUrlsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const urls = previewUrlsRef.current
    return () => {
      Object.values(urls).forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // Dynamic configuration state loaded from API with instant fallback defaults
  const [brandDisplayName, setBrandDisplayName] = useState(() => brand.toUpperCase())
  const [locations, setLocations] = useState<LocationConfig[]>(() => DEFAULT_LOCATIONS_BY_BRAND[brand.toLowerCase()] || DEFAULT_LOCATIONS_BY_BRAND.kia)
  const [approvalTypes, setApprovalTypes] = useState<string[]>(() => DEFAULT_APPROVAL_TYPES)
  const [loadingConfig, setLoadingConfig] = useState(false)

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(true)

  const [glAccounts, setGlAccounts] = useState<any[]>([])
  const [glLoading, setGlLoading] = useState(true)

  const [vendorSearch, setVendorSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [savingVendor, setSavingVendor] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)

  // 1. Fetch Brand Approvals Config
  useEffect(() => {
    setLoadingConfig(true)
    fetch(`/api/brands/${brand}/approvals/config`)
      .then(async (res) => {
        if (!res.ok) return null
        return res.json().catch(() => null)
      })
      .then((data) => {
        if (data && data.success) {
          setBrandDisplayName(data.brandDisplayName || brand.toUpperCase())
          setLocations(data.locations || [])
          const fetchedTypes = (data.approvalTypes || []).filter((t: string) => t.toLowerCase() !== 'petty cash')
          const requiredTypes = ['Crane Charges', 'Key Cutting', 'Tyre fitting / Puncture']
          const combined = Array.from(new Set([...fetchedTypes, ...requiredTypes])).sort()
          setApprovalTypes(combined)
        }
      })
      .catch((err) => console.error('Error loading config:', err))
      .finally(() => setLoadingConfig(false))
  }, [brand])

  // 2. Fetch Vendors List
  useEffect(() => {
    setVendorsLoading(true)
    fetch(`/api/brands/${brand}/vendors`)
      .then(async (res) => {
        if (!res.ok) return null
        return res.json().catch(() => null)
      })
      .then((data) => {
        if (data && Array.isArray(data.vendors)) {
          setVendors(data.vendors)
        }
      })
      .catch((err) => console.error('Error fetching vendors:', err))
      .finally(() => setVendorsLoading(false))
  }, [brand])

  // 3. Fetch GL Accounts List
  useEffect(() => {
    setGlLoading(true)
    fetch(`/api/brands/${brand}/gl-accounts`)
      .then(async (res) => {
        if (!res.ok) return null
        return res.json().catch(() => null)
      })
      .then((data) => {
        if (data && Array.isArray(data.rows)) {
          const rows = data.rows
          setGlAccounts(rows)
          setForm((prev) => {
            if (prev.glAccountId) return prev
            const targetCode = APPROVAL_TYPE_TO_GL_CODE[prev.approvalType] || 'GL-001'
            const matched = rows.find((g: any) => g.glCode === targetCode) || rows[0]
            return { ...prev, glAccountId: matched?.id || '' }
          })
        }
      })
      .catch((err) => console.error('Error fetching GL accounts:', err))
      .finally(() => setGlLoading(false))
  }, [brand])

  // Auto-select GL from Vendor search input change
  useEffect(() => {
    const cleanName = vendorSearch.trim().toLowerCase()
    if (!cleanName) {
      const targetCode = APPROVAL_TYPE_TO_GL_CODE[form.approvalType] || 'GL-001'
      const matchedGl = glAccounts.find(g => g.glCode === targetCode) || glAccounts[0]
      if (matchedGl && form.glAccountId !== matchedGl.id) {
        setForm(prev => ({ ...prev, glAccountId: matchedGl.id }))
      }
      return
    }
    const matchedKey = Object.keys(VENDOR_TO_GL_CODE).find(k => cleanName.includes(k))
    const glCode = matchedKey ? VENDOR_TO_GL_CODE[matchedKey] : null
    if (glCode) {
      const matchedGl = glAccounts.find(g => g.glCode === glCode)
      if (matchedGl && form.glAccountId !== matchedGl.id) {
        setForm(prev => ({ ...prev, glAccountId: matchedGl.id }))
      }
    } else {
      const targetCode = APPROVAL_TYPE_TO_GL_CODE[form.approvalType] || 'GL-001'
      const matchedGl = glAccounts.find(g => g.glCode === targetCode) || glAccounts[0]
      if (matchedGl && form.glAccountId !== matchedGl.id) {
        setForm(prev => ({ ...prev, glAccountId: matchedGl.id }))
      }
    }
  }, [vendorSearch, glAccounts, form.approvalType])

  // Sync vendorSearch if form.vendorName is cleared or set externally
  useEffect(() => {
    if (form.vendorName) {
      setVendorSearch(form.vendorName)
    } else {
      setVendorSearch('')
    }
  }, [form.vendorName])

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredVendors = useMemo(() => {
    if (!vendorSearch.trim()) return vendors
    const query = vendorSearch.toLowerCase()
    return vendors.filter(v =>
      v.name.toLowerCase().includes(query) ||
      (v.gstNumber && v.gstNumber.toLowerCase().includes(query))
    )
  }, [vendors, vendorSearch])

  const handleQuickCreateVendor = async (nameToCreate: string) => {
    const name = nameToCreate.trim()
    if (!name) return
    setSavingVendor(true)
    try {
      const response = await fetch(`/api/brands/${brand}/vendors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      const data = await response.json()
      if (response.ok && data.vendor) {
        setVendors(prev => [data.vendor, ...prev])
        setForm(prev => ({ ...prev, vendorName: data.vendor.name }))
        setVendorSearch(data.vendor.name)
        setDropdownOpen(false)
      } else {
        alert(data.error || 'Failed to create vendor')
      }
    } catch (err) {
      console.error(err)
      alert('Failed to connect to the server')
    } finally {
      setSavingVendor(false)
    }
  }

  const handleTextChange = (key: keyof FormState, value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      
      // Auto-correlate Location / Dealer Code / Dealer Name dynamically
      if (key === 'location') {
        const found = locations.find(l => l.location === value)
        if (found) {
          next.dealerCode = found.dealerCode
          next.dealerName = found.dealerName
        } else {
          next.dealerCode = ''
          next.dealerName = ''
        }
      } else if (key === 'dealerCode') {
        const found = locations.find(l => l.dealerCode === value)
        if (found) {
          next.location = found.location
          next.dealerName = found.dealerName
        } else {
          next.location = ''
          next.dealerName = ''
        }
      } else if (key === 'dealerName') {
        const found = locations.find(l => l.dealerName === value)
        if (found) {
          next.location = found.location
          next.dealerCode = found.dealerCode
        } else {
          next.location = ''
          next.dealerCode = ''
        }
      } else if (key === 'approvalType') {
        const glCode = APPROVAL_TYPE_TO_GL_CODE[value]
        const matchedGl = glAccounts.find(g => g.glCode === (glCode || 'GL-001')) || glAccounts[0]
        if (matchedGl) {
          next.glAccountId = matchedGl.id
        }
      } else if (key === 'vendorName') {
        const cleanName = value.trim().toLowerCase()
        const matchedKey = Object.keys(VENDOR_TO_GL_CODE).find(k => cleanName.includes(k))
        const glCode = matchedKey ? VENDOR_TO_GL_CODE[matchedKey] : null
        if (glCode) {
          const matchedGl = glAccounts.find(g => g.glCode === glCode)
          if (matchedGl) {
            next.glAccountId = matchedGl.id
          }
        } else {
          const targetCode = APPROVAL_TYPE_TO_GL_CODE[next.approvalType] || 'GL-001'
          const matchedGl = glAccounts.find(g => g.glCode === targetCode) || glAccounts[0]
          if (matchedGl) {
            next.glAccountId = matchedGl.id
          }
        }
      }

      return next
    })
  }

  const UPLOAD_URL_FIELD = {
    doc: 'uploadDocUrl',
  } as const

  type UploadKey = keyof UploadState

  const releasePreview = (key: UploadKey) => {
    const existing = previewUrlsRef.current[key]
    if (existing) {
      URL.revokeObjectURL(existing)
      delete previewUrlsRef.current[key]
    }
  }

  const handleRemoveUpload = (key: UploadKey) => {
    releasePreview(key)
    setForm(prev => ({ ...prev, [UPLOAD_URL_FIELD[key]]: '' }))
    setUploads(prev => ({ ...prev, [key]: { ...EMPTY_UPLOAD_SLOT } }))
  }

  const handleFileUpload = (key: UploadKey, file: File) => {
    const isPdf = file.type === 'application/pdf'
    const isImage = file.type.startsWith('image/')

    // Validate before the request: the server rejects >15MB anyway, and the `accept` attribute is
    // only a filter in the picker — drag-and-drop bypasses it entirely.
    if (!isPdf && !isImage) {
      releasePreview(key)
      setUploads(prev => ({
        ...prev,
        [key]: { ...EMPTY_UPLOAD_SLOT, error: 'Only PDF, JPG or PNG files are allowed.' },
      }))
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      releasePreview(key)
      setUploads(prev => ({
        ...prev,
        [key]: {
          ...EMPTY_UPLOAD_SLOT,
          error: `${formatBytes(file.size)} is over the 15MB limit.`,
        },
      }))
      return
    }

    // Replacing an existing pick: drop the old blob before minting a new one.
    releasePreview(key)
    const previewUrl = isImage ? URL.createObjectURL(file) : ''
    if (previewUrl) previewUrlsRef.current[key] = previewUrl

    setUploads(prev => ({
      ...prev,
      [key]: {
        name: file.name,
        size: file.size,
        kind: isImage ? 'image' : 'pdf',
        previewUrl,
        loading: true,
        progress: 0,
        error: '',
      },
    }))
    // Clear any previously stored URL so a failed replace can't leave the old file attached.
    setForm(prev => ({ ...prev, [UPLOAD_URL_FIELD[key]]: '' }))

    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'approvals')

    // XHR rather than fetch: fetch has no upload-progress event, and these are phone photos of
    // invoices on dealership wifi — a percentage is the difference between waiting and re-tapping.
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/brands/${brand}/approvals/upload`)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const progress = Math.round((event.loaded / event.total) * 100)
      setUploads(prev => ({ ...prev, [key]: { ...prev[key], progress } }))
    }

    const fail = (message: string) => {
      releasePreview(key)
      setUploads(prev => ({ ...prev, [key]: { ...EMPTY_UPLOAD_SLOT, error: message } }))
    }

    xhr.onload = () => {
      let data: { url?: string; error?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        return fail('Upload failed. Please try again.')
      }

      if (xhr.status < 200 || xhr.status >= 300 || data.error || !data.url) {
        return fail(data.error || 'Upload failed. Please try again.')
      }

      setForm(prev => ({ ...prev, [UPLOAD_URL_FIELD[key]]: data.url as string }))
      setUploads(prev => ({ ...prev, [key]: { ...prev[key], loading: false, progress: 100, error: '' } }))
    }

    xhr.onerror = () => fail('Connection lost during upload. Please try again.')
    xhr.ontimeout = () => fail('Upload timed out. Please try again.')

    xhr.send(fd)
  }

  /* ---- Bills: one control, many files ------------------------------------------------------ */

  // Kept so a failed bill can be retried without asking the submitter to find the file again.
  const billFilesRef = useRef<Record<string, File>>({})

  const patchBill = (id: string, patch: Partial<BillItem>) =>
    setBills(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)))

  const uploadBill = (id: string, file: File) => {
    patchBill(id, { loading: true, progress: 0, error: '', url: '' })

    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'approvals')

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/brands/${brand}/approvals/upload`)

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return
      patchBill(id, { progress: Math.round((event.loaded / event.total) * 100) })
    }

    // A failure marks only THIS bill; the others keep their uploads.
    const fail = (message: string) => patchBill(id, { loading: false, progress: 0, error: message })

    xhr.onload = () => {
      let data: { url?: string; error?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        return fail('Upload failed.')
      }
      if (xhr.status < 200 || xhr.status >= 300 || data.error || !data.url) {
        return fail(data.error || 'Upload failed.')
      }
      patchBill(id, { loading: false, progress: 100, error: '', url: data.url })
    }

    xhr.onerror = () => fail('Connection lost.')
    xhr.ontimeout = () => fail('Upload timed out.')
    xhr.send(fd)
  }

  const handleAddBills = (files: File[]) => {
    const accepted: BillItem[] = []

    for (const file of files) {
      const isPdf = file.type === 'application/pdf'
      const isImage = file.type.startsWith('image/')
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `bill-${Date.now()}-${accepted.length}`

      // Rejected files still appear in the list, carrying their reason — silently dropping a file
      // the submitter just chose reads as the upload being broken.
      if (!isPdf && !isImage) {
        accepted.push({
          id, name: file.name, size: file.size, kind: 'pdf', previewUrl: '',
          loading: false, progress: 0, url: '', canRetry: false,
          error: 'Only PDF, JPG or PNG files are allowed.',
        })
        continue
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        accepted.push({
          id, name: file.name, size: file.size, kind: isImage ? 'image' : 'pdf', previewUrl: '',
          loading: false, progress: 0, url: '', canRetry: false,
          error: `${formatBytes(file.size)} is over the 15MB limit.`,
        })
        continue
      }

      const previewUrl = isImage ? URL.createObjectURL(file) : ''
      if (previewUrl) billPreviewsRef.current[id] = previewUrl
      billFilesRef.current[id] = file

      accepted.push({
        id, name: file.name, size: file.size, kind: isImage ? 'image' : 'pdf', previewUrl,
        loading: true, progress: 0, error: '', url: '', canRetry: true,
      })
    }

    setBills(prev => [...prev, ...accepted])
    // Each upload runs independently, so a slow bill never holds up the rest.
    accepted.forEach(item => {
      const file = billFilesRef.current[item.id]
      if (file && !item.error) uploadBill(item.id, file)
    })
  }

  const handleRemoveBill = (id: string) => {
    const preview = billPreviewsRef.current[id]
    if (preview) {
      URL.revokeObjectURL(preview)
      delete billPreviewsRef.current[id]
    }
    delete billFilesRef.current[id]
    setBills(prev => prev.filter(b => b.id !== id))
  }

  const handleRetryBill = (id: string) => {
    const file = billFilesRef.current[id]
    if (file) uploadBill(id, file)
  }

  const executeSubmit = async () => {
    setSubmitting(true)
    setErrorMsg('')

    // User vendor value check (fallback to typed input if not selected)
    const finalVendorName = form.vendorName || vendorSearch.trim()
    const submissionForm = {
      ...form,
      vendorName: finalVendorName,
      // Only bills that actually landed. Anything still uploading or errored is left out rather
      // than sent as a blank, which would look to Accounts like a bill that exists.
      billUrls: bills.filter(b => b.url).map(b => b.url),
      // Present only when the form was opened from a send-back email link: tells the server to
      // update the original request instead of creating a duplicate.
      ...(resubmitToken ? { resubmitToken } : {})
    }

    try {
      const res = await fetch(`/api/brands/${brand}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionForm)
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to submit request')
      }

      setSubmittedId(data.id)
    } catch (err) {
      console.error(err)
      setErrorMsg(err instanceof Error ? err.message : 'Connection failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const uniqueNames = useMemo(() => {
    const fromState = locations.map(l => l.dealerName || l.location).filter(Boolean)
    if (fromState.length > 0) {
      return Array.from(new Set(fromState)).sort()
    }
    const brandDefaults = DEFAULT_LOCATIONS_BY_BRAND[brand.toLowerCase()] || []
    return brandDefaults.map(l => l.dealerName || l.location).sort()
  }, [locations, brand])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    // Email Validation & Typo Domain Check
    const emailCheck = validateEmailDomain(form.email)
    if (!emailCheck.valid) {
      return setErrorMsg(emailCheck.error || 'Please enter a valid email address.')
    }
    /*
     * Every field except bills and documents is mandatory, for all brands. The rule itself lives in
     * lib/approvals/required-fields.ts so this form and BOTH create routes enforce the same list —
     * the server is the real control here, because the endpoint is unauthenticated by design.
     *
     * The old GL-account fallback that used to sit here was removed with the same change. It called
     * setForm() at submit time, which is async, so it never affected the request in flight — the
     * request went out with the empty value anyway. GL account is now simply required.
     */
    const missingField = findMissingApprovalField({
      ...form,
      vendorName: form.vendorName || vendorSearch.trim(),
    })
    if (missingField) return setErrorMsg(missingField)

    // Don't let a request go in while a bill is still uploading — it would submit without it.
    if (bills.some(b => b.loading)) {
      return setErrorMsg('Please wait for the bills to finish uploading.')
    }

    if (brand === 'kia' && !bills.some(b => b.url)) {
      setShowConfirmSubmit(true)
      return
    }

    await executeSubmit()
  }

  if (loadingConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          <span className="text-sm text-slate-500">Loading form…</span>
        </div>
      </div>
    )
  }

  if (submittedId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <CheckCircle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">Request submitted</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            It&rsquo;s with the approvers now. We&rsquo;ll email you as it moves.
          </p>

          <dl className="mt-6 divide-y divide-slate-100 rounded-xl bg-slate-50 px-4 py-1">
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs font-medium text-slate-500">Reference</dt>
              <dd className="select-all truncate font-mono text-xs text-slate-900">{submittedId}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs font-medium text-slate-500">Requester</dt>
              <dd className="truncate text-[13px] font-medium text-slate-900">{form.name}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs font-medium text-slate-500">Amount</dt>
              <dd className="text-[13px] font-semibold tabular-nums text-slate-900">
                ₹{Number(form.amount).toLocaleString('en-IN')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-xs font-medium text-slate-500">Type</dt>
              <dd className="truncate text-[13px] font-medium text-slate-900">{form.approvalType}</dd>
            </div>
          </dl>
          <div className="mt-6">
          <button
            onClick={() => {
              setSubmittedId(null)
              setForm({
                email: '',
                name: '',
                location: '',
                dealerCode: '',
                dealerName: '',
                department: '',
                specifyOtherDepartment: '',
                approvalType: '',
                vendorName: '',
                specifyOtherApprovalType: '',
                previousAdvance: '',
                amount: '',
                typeOfPayment: '',
                remarks: '',
                billUrls: [],
                uploadDocUrl: '',
                glAccountId: '',
                gst: '',
                vehicleNumber: ''
              })
              // Revoke the previous submission's previews before clearing state, or the blobs
              // leak for every extra request filed in the same tab.
              releasePreview('doc')
              Object.values(billPreviewsRef.current).forEach(u => URL.revokeObjectURL(u))
              billPreviewsRef.current = {}
              billFilesRef.current = {}
              setBills([])
              setUploads({ doc: { ...EMPTY_UPLOAD_SLOT } })
              setVendorSearch('')
            }}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[var(--dashboard-action-bg)] px-6 text-sm font-semibold text-white shadow-lg shadow-[color:rgba(var(--dashboard-primary-rgb),0.28)] transition duration-150 hover:bg-[var(--dashboard-action-hover)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:rgba(var(--dashboard-primary-rgb),0.22)]"
          >
            Submit another request
          </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---- Live docket state -------------------------------------------------------------------
   * The submitter has no dashboard to check afterwards, so everything they are about to send is
   * mirrored beside the fields (and under their thumb on a phone) while they type.
   * ----------------------------------------------------------------------------------------- */

  const amountNumber = Number(form.amount)
  const amountValid = Boolean(form.amount) && !isNaN(amountNumber) && amountNumber > 0
  const amountFormatted = amountValid
    ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amountNumber)
    : ''
  const amountWords = amountValid ? amountInWordsINR(amountNumber) : ''

  const emailValid = Boolean(form.email.trim()) && validateEmailDomain(form.email).valid
  const uploadedBillCount = bills.filter(b => b.url).length
  const attachedCount = uploadedBillCount + (form.uploadDocUrl ? 1 : 0)

  const sectionComplete = {
    requester: Boolean(form.name.trim()) && emailValid,
    dealer: Boolean(form.dealerName && form.department && form.specifyOtherDepartment),
    payment: Boolean(form.approvalType) && amountValid && Boolean(form.typeOfPayment),
    documents: attachedCount > 0,
  }

  const effectiveApprovalType =
    form.approvalType === 'Others' && form.specifyOtherApprovalType
      ? form.specifyOtherApprovalType
      : form.approvalType

  // Named so the submitter can see what is still missing instead of hunting after a rejected submit.
  const outstanding: string[] = []
  if (!form.name.trim()) outstanding.push('Your name')
  if (!emailValid) outstanding.push('A valid email address')
  if (!form.dealerName) outstanding.push('Dealer name')
  if (!form.department) outstanding.push('Approval category')
  if (!form.specifyOtherDepartment) outstanding.push('Department')
  if (!form.approvalType) outstanding.push('Approval type')
  if (!amountValid) outstanding.push('Payment amount')
  if (!form.typeOfPayment) outstanding.push('Payment type')

  const readyToSubmit = outstanding.length === 0

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Masthead. The paper below rises into it, so the page has an anchor instead of floating. */}
      <header className="bg-[var(--dashboard-primary)]">
        <div className="mx-auto max-w-6xl px-4 pb-32 pt-10 sm:px-6 lg:px-8">
          {/*
            Set as type, not artwork: "AM" leans right, the brand name stays upright. A skew rather
            than italic — the UI face has no true italic here, and a synthesised one would slant the
            letterforms unevenly at this size.

            `brandDisplayName` already reads "AM Kia" / "AM Hyundai", so the leading AM is stripped
            before the second half is set upright — otherwise the mark renders "AM AM KIA".
          */}
          <div className="flex items-baseline gap-2 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
            <span className="inline-block origin-bottom-left skew-x-[-12deg]">AM</span>
            <span className="uppercase tracking-wide">
              {brandDisplayName.replace(/^\s*AM\s+/i, '') || brand.toUpperCase()}
            </span>
          </div>

          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Approval request
          </h1>
          {/* Tinted from the surface, not grey: slate-400 cleared the old near-black masthead but
              only reaches 2.97:1 on teal. White at 80% composites to a teal-tinted light. */}
          <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-white/80">
            Tell us what needs paying and attach the bill. Your request goes straight to the
            approvers for {brandDisplayName}, and you&rsquo;ll get an email as it moves. Everything
            is required unless marked optional.
          </p>
        </div>
      </header>

      <div className="mx-auto -mt-24 max-w-6xl px-4 pb-36 sm:px-6 lg:px-8 lg:pb-20">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {resubmitError && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{resubmitError}</span>
              </div>
            )}

            {resubmitId && !resubmitError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  You&rsquo;re re-submitting a request that was sent back
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-amber-800">
                  {resubmitReason
                    ? `Reason it was sent back: ${resubmitReason}`
                    : 'Your earlier details are filled in below. Make the changes asked for and submit again.'}
                </p>
              </div>
            )}

            {/* Form Container */}
            <form
              id="approvals-form"
              onSubmit={handleSubmit}
              className="space-y-10 rounded-2xl bg-white p-5 shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5 sm:p-8 lg:p-10"
            >
              {errorMsg && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                  <span>{errorMsg}</span>
                </div>
              )}

          {/* Section 1: Requester Profile */}
          <Section
            icon={User}
            title="Who is asking"
            description="So approvers know whose request this is and where to reply."
            complete={sectionComplete.requester}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Your name" required>
                <div className="relative">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    required
                    placeholder="Full name"
                    value={form.name}
                    onChange={e => handleTextChange('name', e.target.value)}
                    className={`${CONTROL_BASE} h-12 pl-11 pr-4 text-sm`}
                  />
                </div>
              </Field>

              <Field label="Email address" required>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="name@example.com"
                    value={form.email}
                    onChange={e => handleTextChange('email', e.target.value)}
                    className={`${CONTROL_BASE} h-12 pl-11 pr-4 text-sm`}
                  />
                </div>
                {(() => {
                  if (!form.email.trim()) return null
                  const check = validateEmailDomain(form.email)
                  if (check.valid) return null
                  return (
                    <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none text-amber-600" />
                      <span>{check.error}</span>
                    </p>
                  )
                })()}
              </Field>
            </div>
          </Section>

          {/* Section 2: Dealer & Department */}
          <Section
            icon={MapPin}
            title="Where it belongs"
            description="Routes the request to the right approvers and cost centre."
            complete={sectionComplete.dealer}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Dealer name" required className="sm:col-span-2">
                <SelectShell>
                  <select
                    required
                    value={form.dealerName}
                    onChange={e => handleTextChange('dealerName', e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Choose dealer</option>
                    {uniqueNames.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </SelectShell>
              </Field>

              {/* 1. Approval Category Dropdown (Sales or Service) */}
              <Field label="Approval category" required>
                <SelectShell>
                  <select
                    required
                    value={form.department === 'SERVICE' ? 'SERVICE' : form.department === 'SALES' ? 'SALES' : ''}
                    onChange={e => {
                      const cat = e.target.value
                      setForm(prev => ({
                        ...prev,
                        department: cat,
                        specifyOtherDepartment: cat ? cat : ''
                      }))
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">Choose category</option>
                    <option value="SALES">{brand === 'kia' ? 'Kia Sales' : `${brand.toUpperCase()} Sales`}</option>
                    <option value="SERVICE">{brand === 'kia' ? 'Kia Service' : `${brand.toUpperCase()} Service`}</option>
                  </select>
                </SelectShell>
              </Field>

              {/* 2. Department Dropdown */}
              <Field label="Department" required>
                <SelectShell>
                  <select
                    required
                    value={form.specifyOtherDepartment || ''}
                    onChange={e => {
                      const val = e.target.value
                      const isService = ['SERVICE', 'SPARE PARTS', 'BODY SHOP', 'LABOUR CHARGES', 'MAINTENANCE'].includes(val)
                      setForm(prev => ({
                        ...prev,
                        specifyOtherDepartment: val,
                        department: prev.department || (isService ? 'SERVICE' : 'SALES'),
                      }))
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">Select Department</option>
                    {(form.department === 'SALES'
                      ? [
                          'SALES',
                          'Accessories',
                          'CRM',
                          'INSURANCE',
                          'HP ROMISE',
                          'EMI',
                          'NEW JOINING',
                          'SALES & SERVICE',
                          'HR',
                          'ADMIN',
                          'ACCOUNTS',
                          'EDP / IT',
                          'OTHER',
                        ]
                      : form.department === 'SERVICE'
                      ? [
                          'SERVICE',
                          'SPARE PARTS',
                          'BODY SHOP',
                          'LABOUR CHARGES',
                          'MAINTENANCE',
                          'SALES & SERVICE',
                          'HR',
                          'ADMIN',
                          'ACCOUNTS',
                          'EDP / IT',
                          'OTHER',
                        ]
                      : DEPARTMENT_OPTIONS
                    ).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </SelectShell>
              </Field>
            </div>
          </Section>

          {/* Section 3: Claim / Approval Specifications */}
          <Section
            icon={Building2}
            title="What needs paying"
            description="The amount, who it goes to, and how it should be paid."
            complete={sectionComplete.payment}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Approval type" required>
                <SelectShell>
                  <select
                    required
                    value={form.approvalType}
                    onChange={e => handleTextChange('approvalType', e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Choose approval type</option>
                    {approvalTypes.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </SelectShell>
              </Field>

              <FieldBlock
                label="Vendor name"
                required
                className="relative"
                hint={vendorsLoading ? 'loading…' : undefined}
              >
                <div ref={dropdownRef}>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search vendors…"
                      value={vendorSearch}
                      onFocus={() => setDropdownOpen(true)}
                      onChange={e => {
                        setVendorSearch(e.target.value)
                        setDropdownOpen(true)
                        if (form.vendorName !== e.target.value) {
                          handleTextChange('vendorName', '')
                        }
                      }}
                      className={`${CONTROL_BASE} h-12 pl-4 pr-11 text-sm`}
                    />
                    {form.vendorName && (
                      <button
                        type="button"
                        aria-label="Clear vendor"
                        onClick={() => {
                          handleTextChange('vendorName', '')
                          setVendorSearch('')
                        }}
                        className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {dropdownOpen && (
                    <div className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
                      {filteredVendors.map(v => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            handleTextChange('vendorName', v.name)
                            setVendorSearch(v.name)
                            setDropdownOpen(false)
                          }}
                          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <span className="truncate">{v.name}</span>
                          {v.gstNumber && (
                            <span className="flex-none font-mono text-[11px] text-slate-500">{v.gstNumber}</span>
                          )}
                        </button>
                      ))}

                      <button
                        type="button"
                        disabled={savingVendor}
                        onClick={() => handleQuickCreateVendor(vendorSearch)}
                        className="mt-1 flex w-full items-center gap-2 border-t border-slate-100 px-4 py-3 text-left text-sm font-medium text-[color:var(--dashboard-primary)] transition-colors hover:bg-[rgba(var(--dashboard-primary-rgb),0.06)] disabled:opacity-50"
                      >
                        {savingVendor ? (
                          <Loader2 className="h-4 w-4 flex-none animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 flex-none" />
                        )}
                        <span className="truncate">
                          Add &ldquo;{vendorSearch || 'New vendor'}&rdquo;
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </FieldBlock>

              {form.approvalType === 'Others' && (
                <Field label="Specify approval type" required className="sm:col-span-2">
                  <input
                    type="text"
                    required
                    placeholder="What is this approval for?"
                    value={form.specifyOtherApprovalType}
                    onChange={e => handleTextChange('specifyOtherApprovalType', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>
              )}

              {form.approvalType.toUpperCase().includes('ADVANCE') && (
                <Field label="Previous advance" required className="sm:col-span-2">
                  <input
                    type="text"
                    placeholder="Outstanding previous advance, if any"
                    value={form.previousAdvance}
                    onChange={e => handleTextChange('previousAdvance', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>
              )}

              {(form.approvalType.toLowerCase().includes('stock transfer') || form.approvalType === 'Stock Transfer') && (
                <Field label="Chassis number" required className="sm:col-span-2">
                  <input
                    type="text"
                    required
                    placeholder="Chassis number (VIN)"
                    value={form.vehicleNumber}
                    onChange={e => handleTextChange('vehicleNumber', e.target.value)}
                    className={`${INPUT_CLASS} font-mono tracking-tight`}
                  />
                </Field>
              )}

              {/* The amount is the whole point of the request, so it is the one field with weight. */}
              <div className="sm:col-span-2">
                <Field label="Amount" required>
                  <div className="relative">
                    <IndianRupee className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      required
                      min="1"
                      inputMode="decimal"
                      placeholder="0"
                      value={form.amount}
                      onChange={e => handleTextChange('amount', e.target.value)}
                      className={`${CONTROL_BASE} h-16 pl-14 pr-5 text-2xl font-semibold tabular-nums tracking-tight`}
                    />
                  </div>
                </Field>
                <p
                  className={cn(
                    'mt-2 text-[13px] transition-opacity duration-200',
                    amountWords ? 'text-slate-500 opacity-100' : 'h-0 opacity-0'
                  )}
                  aria-live="polite"
                >
                  {amountWords}
                </p>
              </div>

              <Field label="Type of payment" required>
                <SelectShell>
                  <select
                    required
                    value={form.typeOfPayment}
                    onChange={e => handleTextChange('typeOfPayment', e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Choose payment type</option>
                    {PAYMENT_TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </SelectShell>
              </Field>

              <Field label="GL account" required>
                <SelectShell>
                  <select
                    value={form.glAccountId}
                    onChange={e => handleTextChange('glAccountId', e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Assign automatically</option>
                    {glAccounts.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.glCode} - {g.glName} ({g.tallyGroup})
                      </option>
                    ))}
                  </select>
                </SelectShell>
              </Field>
            </div>
          </Section>



          {/* Section 4: Remarks & Documents */}
          <Section
            icon={FileText}
            title="Bills and notes"
            description="Attach the invoice. Requests without a bill are usually sent back."
            complete={sectionComplete.documents}
          >
            <div className="space-y-6">
              <Field label="Remarks" required>
                <textarea
                  placeholder="What is this payment for?"
                  rows={3}
                  value={form.remarks}
                  onChange={e => handleTextChange('remarks', e.target.value)}
                  className={`${CONTROL_BASE} resize-y p-4 text-sm leading-relaxed`}
                />
              </Field>

              {/* Bills: one control, as many files as the request needs. */}
              <BillsUpload
                items={bills}
                onAdd={handleAddBills}
                onRemove={handleRemoveBill}
                onRetry={handleRetryBill}
              />

              <div className="sm:max-w-xs">
                <UploadSlot
                  label="Other documents"
                  state={uploads.doc}
                  url={form.uploadDocUrl}
                  onSelect={file => handleFileUpload('doc', file)}
                  onRemove={() => handleRemoveUpload('doc')}
                />
              </div>
            </div>
          </Section>

          <div className="flex flex-col gap-4 border-t border-slate-100 pt-7 sm:flex-row sm:items-center">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 sm:max-w-sm">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
              <span>
                Submitting confirms these details are correct and that the invoices are attached.
              </span>
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[var(--dashboard-action-bg)] px-7 text-sm font-semibold text-white shadow-lg shadow-[color:rgba(var(--dashboard-primary-rgb),0.28)] transition duration-150 hover:bg-[var(--dashboard-action-hover)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[color:rgba(var(--dashboard-primary-rgb),0.22)] disabled:opacity-60 sm:ml-auto sm:w-auto"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit request'
              )}
            </button>
          </div>
            </form>
          </div>

          {/* ---- Docket: what Accounts will receive, kept visible while they type ---- */}
          <aside className="hidden lg:sticky lg:top-6 lg:block">
            <div className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Your request</h2>
              </div>

              <div className="px-5 py-5">
                <p className="text-xs font-medium text-slate-500">Amount</p>
                <p
                  className={cn(
                    'mt-1 text-3xl font-semibold tabular-nums tracking-tight transition-colors duration-200',
                    amountValid ? 'text-slate-900' : 'text-slate-500'
                  )}
                >
                  {amountValid ? `₹${amountFormatted}` : '—'}
                </p>
                {amountWords && (
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{amountWords}</p>
                )}
              </div>

              <dl className="divide-y divide-slate-100 border-t border-slate-100 px-5 py-1">
                <DocketRow label="Type" value={effectiveApprovalType} />
                <DocketRow label="Payee" value={form.vendorName || vendorSearch.trim() || null} />
                <DocketRow label="Dealer" value={form.dealerName} />
                <DocketRow label="Department" value={form.specifyOtherDepartment} />
                <DocketRow label="Paid by" value={form.typeOfPayment} />
              </dl>

              <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-4">
                <Paperclip className="h-3.5 w-3.5 flex-none text-slate-400" />
                <span className="text-[13px] font-medium text-slate-600">
                  {attachedCount === 0
                    ? 'No files attached'
                    : `${attachedCount} file${attachedCount > 1 ? 's' : ''} attached`}
                </span>
              </div>

              {/* Naming what is missing beats a rejected submit that scrolls them back to hunt. */}
              {!readyToSubmit && (
                <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
                  <p className="text-xs font-semibold text-slate-700">Still needed</p>
                  <ul className="mt-2 space-y-1.5">
                    {outstanding.map(item => (
                      <li key={item} className="flex items-start gap-2 text-xs text-slate-500">
                        <span
                          className="mt-1.5 h-1 w-1 flex-none rounded-full bg-slate-300"
                          aria-hidden
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {readyToSubmit && (
                <div className="flex items-center gap-2 border-t border-emerald-100 bg-emerald-50/70 px-5 py-4">
                  <ShieldCheck className="h-4 w-4 flex-none text-emerald-600" />
                  <span className="text-[13px] font-medium text-emerald-900">Ready to submit</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile action bar: the amount and the submit stay under the thumb through a long form. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'truncate text-lg font-semibold leading-tight tabular-nums',
                amountValid ? 'text-slate-900' : 'text-slate-500'
              )}
            >
              {amountValid ? `₹${amountFormatted}` : '—'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {readyToSubmit
                ? `${attachedCount} file${attachedCount === 1 ? '' : 's'} attached`
                : `${outstanding.length} field${outstanding.length === 1 ? '' : 's'} left`}
            </p>
          </div>
          <button
            type="submit"
            form="approvals-form"
            disabled={submitting}
            className="inline-flex h-12 flex-none items-center justify-center gap-2 rounded-xl bg-[var(--dashboard-action-bg)] px-6 text-sm font-semibold text-white shadow-lg shadow-[color:rgba(var(--dashboard-primary-rgb),0.28)] transition hover:bg-[var(--dashboard-action-hover)] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
          </button>
        </div>
      </div>

      <Dialog open={showConfirmSubmit} onOpenChange={setShowConfirmSubmit}>
        <DialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl border-0 bg-white p-6 shadow-2xl ring-1 ring-slate-900/5 sm:max-w-md">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
            </div>
            <DialogTitle className="text-lg font-semibold tracking-tight text-slate-900">
              Submit without a bill?
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm leading-relaxed text-slate-500">
            Requests without an invoice attached are usually sent back, which delays payment. You
            can go back and attach one now.
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowConfirmSubmit(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Attach a bill
            </button>
            <button
              type="button"
              onClick={async () => {
                setShowConfirmSubmit(false)
                await executeSubmit()
              }}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--dashboard-action-bg)] px-5 text-sm font-semibold text-white shadow-lg shadow-[color:rgba(var(--dashboard-primary-rgb),0.28)] transition-colors hover:bg-[var(--dashboard-action-hover)]"
            >
              Submit anyway
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
