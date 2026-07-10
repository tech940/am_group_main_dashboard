'use client'

import { Banknote, Loader2, MapPin } from 'lucide-react'
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
import { PETTY_CASH_DEPARTMENT_OPTIONS, PETTY_CASH_PAYMENT_TYPES } from '@/lib/petty-cash/constants'
import type { RequestFormState } from './types'

export function RequestFormDialog({
  open,
  onOpenChange,
  form,
  onChange,
  onSubmit,
  submitting,
  locationOptions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: RequestFormState
  onChange: <K extends keyof RequestFormState>(field: K, value: RequestFormState[K]) => void
  onSubmit: () => void
  submitting: boolean
  locationOptions: string[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-xl overflow-hidden rounded-3xl border-0 p-0">
        <form
          onSubmit={(event) => { event.preventDefault(); onSubmit() }}
          className="flex max-h-[92dvh] flex-col"
        >
          <DialogHeader className="space-y-2 border-b border-slate-100 bg-gradient-to-br from-slate-900 to-slate-700 p-6 text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
              <Banknote className="h-5 w-5" />
            </span>
            <DialogTitle className="text-2xl font-black tracking-tight text-white">New Petty Cash Request</DialogTitle>
            <DialogDescription className="text-sm font-semibold text-white/70">
              Request a fresh allocation or top-up for your branch.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location" required>
                <Select value={form.location} onValueChange={(value) => onChange('location', value)}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 font-bold">
                    {/* A <div> (not <span>) so the trigger's [&>span]:line-clamp-1 rule can't
                        override this flex row and stack the icon above the text. */}
                    <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-slate-400" /><SelectValue placeholder="Select location" /></div>
                  </SelectTrigger>
                  <SelectContent>
                    {locationOptions.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Department" required>
                <Select value={form.department} onValueChange={(value) => onChange('department', value)}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 font-bold"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_DEPARTMENT_OPTIONS.map((department) => <SelectItem key={department} value={department}>{department}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment Type">
                <Select value={form.typeOfPayment} onValueChange={(value) => onChange('typeOfPayment', value)}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 font-bold"><SelectValue placeholder="Select payment type" /></SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_PAYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount" required>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">₹</span>
                  <Input
                    type="number"
                    min={1}
                    step={0.01}
                    value={form.requestedAmount}
                    onChange={(event) => onChange('requestedAmount', event.target.value)}
                    placeholder="0"
                    className="h-11 rounded-xl border-slate-200 pl-7 font-bold"
                  />
                </div>
              </Field>
            </div>
            <Field label="Purpose" required>
              <Textarea
                rows={5}
                value={form.purpose}
                onChange={(event) => onChange('purpose', event.target.value)}
                placeholder="Describe what this petty cash will be used for…"
                className="rounded-xl border-slate-200 font-medium"
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
            <Button type="button" variant="outline" className="h-11 rounded-xl font-bold" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" className="app-primary-action h-11 rounded-xl px-6 font-bold" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit Request
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
