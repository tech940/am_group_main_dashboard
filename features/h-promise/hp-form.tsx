'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Camera, CheckCircle2, ExternalLink, FileText, Loader2, RotateCcw, Upload, X } from 'lucide-react'
import type { z } from 'zod'
import { cn } from '@/lib/utils'
import { FILE_KIND_POLICY, NOT_TAKEN, NOT_TAKEN_LABEL, type FileKind } from '@/lib/h-promise/constants'
import { MIN_REASON_LENGTH } from '@/lib/h-promise/status'
import type { HpFileRef, HpOption } from '@/lib/h-promise/types'
import { fileUrl, uploadHpFile } from './hp-data'
import { fileSize, inr } from './hp-format'
import { HpButton, Notice } from './hp-ui'

// ── Validation helpers ───────────────────────────────────────────────────────────────────────────

export type FieldErrors = Record<string, string>

/** Runs a shared schema in the browser; returns the first message per field. */
export function validate<T extends z.ZodType>(schema: T, value: unknown): { ok: true; data: z.infer<T> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  const errors: FieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_form'
    if (!errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}

// ── Layout ───────────────────────────────────────────────────────────────────────────────────────

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4 border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="text-[13.5px] font-semibold text-slate-900">{title}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </fieldset>
  )
}

export function FormGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2', className)}>{children}</div>
}

export function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  wide,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string
  hint?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <label htmlFor={htmlFor} className="mb-1 flex items-center gap-1 text-[12px] font-medium text-slate-700">
        {label}
        {required && <span className="hp-accent-text" aria-hidden="true">*</span>}
        {required && <span className="sr-only">(required)</span>}
      </label>
      {children}
      {error ? (
        <p id={hintId} role="alert" data-tone="rejected" className="hp-tone-text mt-1 text-[11.5px] font-medium">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-[11.5px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

const inputClass = (invalid?: boolean) =>
  cn(
    'h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
    invalid ? 'border-transparent' : 'border-slate-200 hover:border-slate-300',
  )

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onValue: (value: string) => void
  invalid?: boolean
}

export const TextInput = React.forwardRef<HTMLInputElement, InputProps>(function TextInput({ value, onValue, invalid, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => onValue(event.target.value)}
      aria-invalid={invalid || undefined}
      data-tone={invalid ? 'rejected' : undefined}
      className={cn(inputClass(invalid), invalid && 'hp-tone', className)}
      autoComplete="off"
      {...props}
    />
  )
})

/** Rupees: digits only while typing, the Indian-grouped figure shown beneath. */
export function MoneyInput({ id, value, onValue, invalid, placeholder, disabled }: { id: string; value: string; onValue: (value: string) => void; invalid?: boolean; placeholder?: string; disabled?: boolean }) {
  const numeric = Number(value.replace(/[,\s₹]/g, ''))
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-hidden="true">₹</span>
      <TextInput
        id={id}
        inputMode="decimal"
        value={value}
        onValue={(next) => onValue(next.replace(/[^\d.,]/g, ''))}
        invalid={invalid}
        placeholder={placeholder}
        disabled={disabled}
        className="hp-num pl-7"
      />
      {value && Number.isFinite(numeric) && numeric > 0 && (
        <span className="hp-num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{inr(numeric)}</span>
      )}
    </div>
  )
}

export function DateInput({ id, value, onValue, invalid, min, max, disabled }: { id: string; value: string; onValue: (value: string) => void; invalid?: boolean; min?: string; max?: string; disabled?: boolean }) {
  return <TextInput id={id} type="date" value={value} onValue={onValue} invalid={invalid} min={min} max={max} disabled={disabled} className="hp-num" />
}

export function TextArea({ id, value, onValue, invalid, rows = 3, placeholder, maxLength, disabled }: { id: string; value: string; onValue: (value: string) => void; invalid?: boolean; rows?: number; placeholder?: string; maxLength?: number; disabled?: boolean }) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onValue(event.target.value)}
      aria-invalid={invalid || undefined}
      data-tone={invalid ? 'rejected' : undefined}
      className={cn(inputClass(invalid), 'h-auto py-2 leading-relaxed', invalid && 'hp-tone')}
    />
  )
}

export function NativeSelect({
  id,
  value,
  onValue,
  invalid,
  placeholder = 'Choose…',
  options,
  disabled,
}: {
  id: string
  value: string
  onValue: (value: string) => void
  invalid?: boolean
  placeholder?: string
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  disabled?: boolean
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onValue(event.target.value)}
      aria-invalid={invalid || undefined}
      data-tone={invalid ? 'rejected' : undefined}
      className={cn(inputClass(invalid), 'pr-8', invalid && 'hp-tone', !value && 'text-slate-400')}
    >
      <option value="" disabled>{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled} className="text-slate-900">
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * A name-list select: active entries, plus the record's current value if it has since been hidden.
 * `withNotTaken` adds "Approval not taken on WhatsApp" last.
 */
export function OptionSelect({
  id,
  options,
  value,
  onValue,
  invalid,
  current,
  withNotTaken,
  placeholder,
  disabled,
}: {
  id: string
  options: HpOption[]
  value: string
  onValue: (value: string) => void
  invalid?: boolean
  current?: string | null
  withNotTaken?: boolean
  placeholder?: string
  disabled?: boolean
}) {
  const list = options
    .filter((option) => option.isActive || option.value === current)
    .map((option) => ({ value: option.value, label: option.isActive ? option.label : `${option.label} (no longer offered)` }))
  if (current && !list.some((option) => option.value === current) && current !== NOT_TAKEN) list.push({ value: current, label: current })
  if (withNotTaken) list.push({ value: NOT_TAKEN, label: NOT_TAKEN_LABEL })
  return <NativeSelect id={id} value={value} onValue={onValue} invalid={invalid} options={list} placeholder={placeholder} disabled={disabled} />
}

export function SuggestInput({ id, value, onValue, suggestions, invalid, placeholder, disabled }: { id: string; value: string; onValue: (value: string) => void; suggestions: string[]; invalid?: boolean; placeholder?: string; disabled?: boolean }) {
  const listId = `${id}-list`
  return (
    <>
      <TextInput id={id} value={value} onValue={onValue} invalid={invalid} list={listId} placeholder={placeholder} disabled={disabled} />
      <datalist id={listId}>
        {suggestions.slice(0, 200).map((suggestion) => <option key={suggestion} value={suggestion} />)}
      </datalist>
    </>
  )
}

/** Yes / No as two buttons: an unanswered question is visible, unlike an unticked box. */
export function YesNo({ id, value, onValue, invalid, yes = 'Yes', no = 'No', disabled }: { id: string; value: boolean | null; onValue: (value: boolean) => void; invalid?: boolean; yes?: string; no?: string; disabled?: boolean }) {
  return (
    <div id={id} role="radiogroup" aria-invalid={invalid || undefined} className={cn('inline-flex rounded-lg border p-0.5', invalid ? 'border-transparent hp-tone' : 'border-slate-200', disabled && 'opacity-50 pointer-events-none')} data-tone={invalid ? 'rejected' : undefined}>
      {[{ v: true, label: yes }, { v: false, label: no }].map((option) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          disabled={disabled}
          aria-checked={value === option.v}
          onClick={() => onValue(option.v)}
          className={cn(
            'h-8 min-w-16 rounded-md px-3 text-xs font-semibold transition-colors',
            value === option.v ? 'hp-accent-bg' : 'hp-hover text-slate-600',
            disabled && 'cursor-not-allowed',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ChoiceChips<T extends string>({ id, value, onValue, options, invalid, disabled }: { id: string; value: T | ''; onValue: (value: T) => void; options: ReadonlyArray<{ value: T; label: string }>; invalid?: boolean; disabled?: boolean }) {
  return (
    <div id={id} role="radiogroup" className={cn("flex flex-wrap gap-1.5", disabled && "opacity-50 pointer-events-none")} aria-invalid={invalid || undefined}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          disabled={disabled}
          aria-checked={value === option.value}
          onClick={() => onValue(option.value)}
          data-tone={invalid && !value ? 'rejected' : undefined}
          className={cn(
            'h-8 rounded-full border px-3.5 text-xs font-semibold transition-colors',
            value === option.value ? 'hp-accent-bg border-transparent' : invalid && !value ? 'hp-tone' : 'border-slate-200 text-slate-600 hover:border-slate-300',
            disabled && 'cursor-not-allowed',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

export type StagedFile = { fileId: string; name: string; sizeBytes: number; previewUrl: string | null; contentType: string }

type SlotState = { status: 'idle' } | { status: 'uploading'; name: string } | { status: 'error'; message: string }

/**
 * One document slot. The file is uploaded the moment it is chosen (one request per file), so a form with six
 * photos never sends a body Vercel would refuse; the form then saves only the returned ids.
 */
export function FileSlot({
  kind,
  label,
  required,
  existing,
  staged,
  onStaged,
  error,
  hint,
  disabled,
}: {
  kind: FileKind
  label?: string
  required?: boolean
  existing?: HpFileRef | null
  staged: StagedFile | null
  onStaged: (file: StagedFile | null) => void
  error?: string
  hint?: string
  disabled?: boolean
}) {
  const policy = FILE_KIND_POLICY[kind]
  const inputId = React.useId()
  const cameraId = React.useId()
  const [state, setState] = React.useState<SlotState>({ status: 'idle' })
  const accept = policy.acceptsPdf ? 'image/jpeg,image/png,image/webp,image/heic,application/pdf' : 'image/jpeg,image/png,image/webp,image/heic'

  const choose = async (file: File | undefined) => {
    if (!file || disabled) return
    setState({ status: 'uploading', name: file.name })
    try {
      const result = await uploadHpFile(kind, file, policy.preset === 'document')
      onStaged({ fileId: result.fileId, name: file.name, sizeBytes: result.sizeBytes, previewUrl: result.previewUrl, contentType: result.contentType })
      setState({ status: 'idle' })
    } catch (reason) {
      setState({ status: 'error', message: reason instanceof Error ? reason.message : 'The file could not be uploaded.' })
    }
  }

  const filled = Boolean(staged || existing)
  const invalid = Boolean(error) || state.status === 'error'
  const title = label ?? policy.label

  return (
    <div
      className={cn("hp-file-tile flex min-w-0 items-center gap-3 rounded-lg p-2.5", disabled && "opacity-50 pointer-events-none bg-slate-50")}
      data-filled={filled}
      data-required={Boolean(required)}
      data-invalid={invalid}
    >
      <Thumb staged={staged} existing={existing ?? null} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[12.5px] font-semibold text-slate-800">
          {title}
          {required && <span className="hp-accent-text" aria-hidden="true">*</span>}
          {required && <span className="sr-only">(required)</span>}
        </p>
        <p className="truncate text-[11.5px] text-slate-500" aria-live="polite">
          {state.status === 'uploading' ? `Uploading ${state.name}…`
            : state.status === 'error' ? <span data-tone="rejected" className="hp-tone-text font-medium">{state.message}</span>
            : staged ? `New: ${staged.name} · ${fileSize(staged.sizeBytes)}`
            : existing ? `On file · uploaded by ${existing.uploadedByName}`
            : error ? <span data-tone="rejected" className="hp-tone-text font-medium">{error}</span>
            : hint ?? (policy.acceptsPdf ? 'Photo or PDF' : 'Photo or screenshot')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state.status === 'uploading' ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
        ) : (
          <>
            {staged && (
              <button type="button" disabled={disabled} onClick={() => onStaged(null)} className="rounded-md p-1.5 hp-hover text-slate-400 disabled:cursor-not-allowed" aria-label={`Undo the new ${title}`} title="Undo">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <label htmlFor={cameraId} className={cn("cursor-pointer rounded-md p-1.5 hp-hover text-slate-500 sm:hidden", disabled && "cursor-not-allowed pointer-events-none")} title="Take a photo">
              <Camera className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Take a photo of the {title}</span>
            </label>
            <input id={cameraId} type="file" disabled={disabled} accept="image/*" capture="environment" className="sr-only" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
            <label
              htmlFor={inputId}
              className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-slate-300", disabled && "cursor-not-allowed pointer-events-none opacity-60")}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {filled ? 'Replace' : 'Upload'}
              <span className="sr-only"> {title}</span>
            </label>
            <input id={inputId} type="file" disabled={disabled} accept={accept} className="sr-only" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
          </>
        )}
      </div>
    </div>
  )
}

function Thumb({ staged, existing }: { staged: StagedFile | null; existing: HpFileRef | null }) {
  const preview = staged?.previewUrl ?? existing?.previewUrl ?? null
  const isPdf = (staged?.contentType ?? existing?.contentType) === 'application/pdf'
  const box = 'flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white'
  if (preview) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className={box}><img src={preview} alt="" className="h-full w-full object-cover" /></span>
  }
  if (staged || existing) {
    return (
      <span className={box} data-tone="approved">
        {isPdf ? <FileText className="hp-tone-text h-5 w-5" aria-hidden="true" /> : <CheckCircle2 className="hp-tone-text h-5 w-5" aria-hidden="true" />}
      </span>
    )
  }
  return <span className={cn(box, 'border-dashed text-slate-300')}><Upload className="h-4 w-4" aria-hidden="true" /></span>
}

/** A stored file as a tile that opens it (through the logging route). */
export function FileTile({ file, label }: { file: HpFileRef; label?: string }) {
  const policy = FILE_KIND_POLICY[file.kind]
  const title = label ?? policy.label
  const content = (
    <>
      <Thumb staged={null} existing={file} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-slate-800">{title}</span>
        <span className="block truncate text-[11px] text-slate-500">
          {file.canOpen ? (file.source === 'import' ? 'Copied from the sheet' : `By ${file.uploadedByName}`) : 'On file · not visible at your access'}
        </span>
      </span>
      {file.canOpen && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
    </>
  )
  if (!file.canOpen) {
    return <div className="hp-file-tile flex items-center gap-2.5 rounded-lg p-2" data-filled="true">{content}</div>
  }
  return (
    <a
      href={fileUrl(file.id)}
      target="_blank"
      rel="noopener noreferrer"
      className="hp-file-tile flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:border-slate-300"
      data-filled="true"
      title={`Open ${title}${policy.sensitivity !== 'normal' ? ' (the opening is recorded)' : ''}`}
    >
      {content}
    </a>
  )
}

// ── Reason dialog ────────────────────────────────────────────────────────────────────────────────

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = 'Reason',
  confirmLabel,
  tone = 'rejected',
  optional = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  label?: string
  confirmLabel: string
  tone?: 'rejected' | 'accent'
  optional?: boolean
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()
  // Callers mount this dialog only while it is open, so every opening starts empty.

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!optional && trimmed.length < MIN_REASON_LENGTH) {
      setError(`Write at least ${MIN_REASON_LENGTH} characters, so the person who entered it knows what to fix.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(trimmed)
      onOpenChange(false)
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="hp-overlay fixed inset-0 z-[60] bg-slate-950/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="hp fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-2xl focus:outline-none">
          <form onSubmit={submit} className="space-y-5">
            <div>
              <DialogPrimitive.Title className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-xs sm:text-[13px] text-slate-500">{description ?? 'This is recorded in the history.'}</DialogPrimitive.Description>
            </div>
            <FormField label={label} htmlFor={id} required={!optional}>
              <TextArea id={id} value={reason} onValue={setReason} rows={3} maxLength={500} invalid={Boolean(error)} />
            </FormField>
            {error && <Notice tone="rejected">{error}</Notice>}
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
              <DialogPrimitive.Close asChild>
                <HpButton variant="outline" disabled={busy}>Cancel</HpButton>
              </DialogPrimitive.Close>
              <HpButton type="submit" variant={tone === 'rejected' ? 'reject' : 'accent'} busy={busy}>
                {confirmLabel}
              </HpButton>
            </div>
          </form>
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" aria-label="Close" disabled={busy}>
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
