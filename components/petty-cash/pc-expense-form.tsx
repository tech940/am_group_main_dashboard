'use client'

import { FileText, Loader2, MapPin, ReceiptText, UploadCloud, X, AlertCircle} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from './pc-shared'
import type { ExpenseFormState, PettyCashCategory } from './types'

function fileName(url: string) {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split('/').pop() || url)
  } catch {
    return url.split('/').pop() || url
  }
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|heic|heif)$/i

export function ExpenseFormDialog({
  open,
  onOpenChange,
  form,
  onChange,
  onSubmit,
  submitting,
  categories,
  locationOptions,
  allocationNumber,
  remainingAmount,
  expenseFiles,
  onUpload,
  onRemoveFile,
  formError,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: ExpenseFormState
  onChange: <K extends keyof ExpenseFormState>(field: K, value: ExpenseFormState[K]) => void
  onSubmit: () => void
  submitting: boolean
  categories: PettyCashCategory[]
  locationOptions: string[]
  allocationNumber: string
  remainingAmount: number
  expenseFiles: string[]
  onUpload: (files: FileList | null) => void
  onRemoveFile: (index: number) => void
  /** Client-side validation message for THIS form; rendered in the footer below. */
  formError?: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-3xl border-0 p-0">
        <form
          onSubmit={(event) => { event.preventDefault(); onSubmit() }}
          className="flex max-h-[92dvh] flex-col"
        >
          <DialogHeader className="space-y-2 border-b border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-emerald-400 border border-white/10">
              <ReceiptText className="h-5 w-5" />
            </span>
            <DialogTitle className="text-2xl font-black tracking-tight text-white">Submit Expense</DialogTitle>
            <DialogDescription className="text-sm font-semibold text-slate-300">
              Post a spend against your active allocation. Remaining: <span className="text-emerald-400 font-bold">{formatCurrency(remainingAmount)}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Active Allocation">
                <Input value={allocationNumber || 'No active allocation'} disabled className="h-11 rounded-xl border-slate-200 bg-slate-50 font-bold" />
              </Field>
              <Field label="Amount" required>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">₹</span>
                  <Input
                    type="number"
                    min={1}
                    step={0.01}
                    value={form.amount}
                    onChange={(event) => onChange('amount', event.target.value)}
                    placeholder="0"
                    className="h-11 rounded-xl border-slate-200 pl-7 font-bold"
                  />
                </div>
              </Field>
              <Field label="Date">
                <Input type="date" value={form.expenseDate} onChange={(event) => onChange('expenseDate', event.target.value)} className="h-11 rounded-xl border-slate-200 font-bold" />
              </Field>
              <Field label="Category">
                <Select value={form.categoryId} onValueChange={(value) => onChange('categoryId', value)} disabled={categories.length === 0}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 font-bold"><SelectValue placeholder={categories.length ? 'Select category' : 'No categories'} /></SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Location" required>
                <Select value={form.location} onValueChange={(value) => onChange('location', value)}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 font-bold">
                    {/* A <div> (not <span>) so the trigger's [&>span]:line-clamp-1 rule can't
                        override this flex row and stack the icon above the text. */}
                    <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-slate-500" /><SelectValue placeholder="Where was it spent?" /></div>
                  </SelectTrigger>
                  <SelectContent>
                    {locationOptions.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Vendor Name">
                <Input value={form.vendorName} onChange={(event) => onChange('vendorName', event.target.value)} placeholder="e.g. Local Hardware" className="h-11 rounded-xl border-slate-200 font-bold" />
              </Field>
              <Field label="Received By">
                <Input value={form.receivedBy} onChange={(event) => onChange('receivedBy', event.target.value)} placeholder="Who received the cash" className="h-11 rounded-xl border-slate-200 font-bold" />
              </Field>
            </div>

            <Field label="Purpose of Expense" required>
              <Textarea rows={5} value={form.purpose} onChange={(event) => onChange('purpose', event.target.value)} placeholder="Describe the expense…" className="rounded-xl border-slate-200 font-medium" />
            </Field>

            <div className="space-y-2">
              {/* A <span>, not <Label>: the drop-zone <label> below owns the association, and a second
                  <label> pointing at no control is a dangling one. */}
              <span className="block text-[11px] font-black uppercase tracking-wider text-slate-600">
                Upload Bill <span className="text-rose-600" aria-hidden>*</span>
                <span className="sr-only"> (required)</span>
              </span>
              {/*
                * sr-only, NOT hidden.
                *
                * `hidden` is display:none, which removes the input from the focus order entirely —
                * and a <label> is not tabbable either, so there was no way to reach this control from
                * a keyboard at all. On a REQUIRED field that made the expense form impossible to
                * complete without a mouse. sr-only keeps it visually hidden but focusable, and
                * focus-within moves the ring onto the drop zone the user can actually see.
                */}
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center transition-colors hover:border-slate-300 hover:bg-slate-50 focus-within:border-[var(--dashboard-action-bg)] focus-within:ring-2 focus-within:ring-[var(--dashboard-action-bg)]/40">
                <UploadCloud className="h-6 w-6 text-slate-500" />
                <span className="text-sm font-bold text-slate-600">Click to upload bills</span>
                <span className="text-xs font-medium text-slate-500">PNG, JPG, PDF · multiple allowed</span>
                <input type="file" multiple className="sr-only" onChange={(event) => onUpload(event.target.files)} />
              </label>
              {expenseFiles.length > 0 && (
                <div className="space-y-2">
                  {expenseFiles.map((url, index) => (
                    <div key={`${url}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                      {IMAGE_RE.test(url) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="bill" className="h-9 w-9 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><FileText className="h-4 w-4" /></span>
                      )}
                      <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 hover:underline">{fileName(url)}</a>
                      <button type="button" onClick={() => onRemoveFile(index)} className="flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-action-bg)] focus-visible:ring-offset-1">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/*
            * The validation message lives INSIDE the dialog, beside the button that produced it.
            * These messages used to go to a page-level banner rendered behind this overlay, so a
            * failed submit looked like a dead button — the single most demoralising interaction in
            * software, on the form that moves cash. role="alert" announces it too.
            */}
          {formError && (
            <div role="alert" className="flex items-start gap-2 border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
            <Button type="button" variant="outline" className="h-11 rounded-xl font-bold" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" className="h-11 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-700" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Post Expense
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/*
 * A native <label> WRAPPING the control, rather than a <div> beside it.
 *
 * These fields rendered a styled <Label> with no htmlFor, so all 19 inputs across the two forms were
 * announced as unlabelled edit boxes on a form that moves cash. Implicit association names the single
 * labelable descendant — Input, Textarea and SelectTrigger (a <button>) all qualify — which fixes
 * every field without threading a generated id through each call site.
 *
 * The inner element is a <span>, not <Label>: nesting a <label> inside a <label> is invalid and
 * breaks the very association this exists to create.
 */
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-black uppercase tracking-wider text-slate-600">
        {label}
        {required && <span className="text-rose-600" aria-hidden> *</span>}
        {/* The asterisk is colour + glyph only; name the requirement for screen readers too. */}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      {children}
    </label>
  )
}
