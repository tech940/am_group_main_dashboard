'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * "Branch not listed? Add it" — the one control, used by Finance, the proforma and the booking form.
 *
 * ── Why it is shared ──────────────────────────────────────────────────────────────────────────
 * All three screens read the SAME branch list from /api/brands/kia/proforma/options, so all three
 * hit the same wall when a branch is missing. Three copies of this would be three chances for the
 * validation, the wording and the cache handling to drift — and the branch list has already drifted
 * once (Finance and the proforma carry different `extraDefaultBanks`).
 *
 * On success the parent is handed the STORED spelling via `onAdded`, not the typed one: the server
 * may return an existing row that differs only in case, and selecting the typed string would leave
 * the field holding a value that matches nothing in the refreshed list.
 */
export function AddBankBranch({
  bankName,
  onAdded,
  className,
}: {
  /** The bank the branch belongs to. Empty disables the control — a branch needs a parent. */
  bankName: string
  /** Called with the branch as STORED, so the caller can select it. */
  onAdded: (branch: string) => void | Promise<void>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const reset = () => { setOpen(false); setValue(''); setError(null); setNote(null) }

  const submit = async () => {
    const branch = value.trim()
    if (!branch || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/brands/kia/proforma/options/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankName, bankBranch: branch }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not add the branch.')
        return
      }
      // The server's spelling wins — see the note above.
      await onAdded(String(data?.bankBranch || branch))
      setNote(typeof data?.message === 'string' ? data.message : null)
      setOpen(false)
      setValue('')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className={cn('mt-1', className)}>
        <button
          type="button"
          onClick={() => { setOpen(true); setNote(null) }}
          disabled={!bankName}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 disabled:text-slate-300 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 cursor-pointer"
          // Says WHY it is disabled rather than leaving a dead control.
          title={bankName ? 'Add a branch that is not in the list' : 'Pick a bank first'}
        >
          <Plus className="h-3 w-3" />
          Branch not listed? Add it
        </button>
        {note && <p className="mt-1 text-[11px] font-medium text-emerald-700">{note}</p>}
      </div>
    )
  }

  return (
    <div className={cn('mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2', className)}>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
        New branch for {bankName}
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit() }
            if (e.key === 'Escape') { e.preventDefault(); reset() }
          }}
          autoFocus
          maxLength={120}
          placeholder="e.g. J&K BANK ARLI KATRA"
          className="h-9 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          className="h-9 shrink-0 inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="h-9 shrink-0 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] font-semibold text-rose-600">{error}</p>}
      <p className="mt-1 text-[10px] text-slate-500">
        Saved to the shared list — it will be there next time, on this screen and the others.
      </p>
    </div>
  )
}
