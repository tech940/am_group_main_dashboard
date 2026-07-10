'use client'

import { FileText, Loader2, MapPin, ReceiptText, UploadCloud, X } from 'lucide-react'
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
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-3xl border-0 p-0">
        <form
          onSubmit={(event) => { event.preventDefault(); onSubmit() }}
          className="flex max-h-[92dvh] flex-col"
        >
          <DialogHeader className="space-y-2 border-b border-slate-100 bg-gradient-to-br from-teal-700 to-emerald-600 p-6 text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
              <ReceiptText className="h-5 w-5" />
            </span>
            <DialogTitle className="text-2xl font-black tracking-tight text-white">Submit Expense</DialogTitle>
            <DialogDescription className="text-sm font-semibold text-white/70">
              Post a spend against your active allocation. Remaining: {formatCurrency(remainingAmount)}.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Active Allocation">
                <Input value={allocationNumber || 'No active allocation'} disabled className="h-11 rounded-xl border-slate-200 bg-slate-50 font-bold" />
              </Field>
              <Field label="Amount" required>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₹</span>
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
                    <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-slate-400" /><SelectValue placeholder="Where was it spent?" /></div>
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
              <Label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                Upload Bill <span className="text-rose-500">*</span>
              </Label>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center transition-colors hover:border-slate-300 hover:bg-slate-50">
                <UploadCloud className="h-6 w-6 text-slate-400" />
                <span className="text-sm font-bold text-slate-600">Click to upload bills</span>
                <span className="text-xs font-medium text-slate-400">PNG, JPG, PDF · multiple allowed</span>
                <input type="file" multiple className="hidden" onChange={(event) => onUpload(event.target.files)} />
              </label>
              {expenseFiles.length > 0 && (
                <div className="space-y-2">
                  {expenseFiles.map((url, index) => (
                    <div key={`${url}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                      {IMAGE_RE.test(url) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="bill" className="h-9 w-9 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><FileText className="h-4 w-4" /></span>
                      )}
                      <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 hover:underline">{fileName(url)}</a>
                      <button type="button" onClick={() => onRemoveFile(index)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
    </div>
  )
}
