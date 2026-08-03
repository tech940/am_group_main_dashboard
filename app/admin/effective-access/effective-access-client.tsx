'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Eye, EyeOff, Search } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AccessReason, EffectiveAccessReport, SectionAccess } from '@/lib/admin/effective-access'

/**
 * "Granted in the Access Map but the sidebar doesn't show it" has been a live incident four times.
 * Each one was diagnosed by reading resolver code and querying the database by hand. This turns
 * that into a lookup.
 *
 * The most valuable thing on the page is the INERT GRANTS count: boxes an admin has ticked that buy
 * the user nothing. Those are invisible in the Access Map itself, because it renders the stored
 * override — not what the resolver ultimately does with it.
 */

type UserRow = { id: string; email: string; fullName: string | null; role: string; brand: string | null; isActive: boolean }

const REASON_STYLE: Record<AccessReason, { label: string; className: string }> = {
  super_admin: { label: 'Super admin', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  explicit_grant: { label: 'Granted to user', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  explicit_deny: { label: 'Denied to user', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  role_template: { label: 'Role template', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  global_access_role: { label: 'Group-wide role', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  default_visible: { label: 'Default', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  restricted_default: { label: 'Deny by default', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  other_brand: { label: 'Other brand', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  not_in_template: { label: 'Not granted', className: 'bg-slate-100 text-slate-500 border-slate-200' },
}

function SectionRow({ section }: { section: SectionAccess }) {
  const style = REASON_STYLE[section.reason]
  // A ticked box that buys nothing — the exact failure this page exists to surface.
  const inert = section.overrideValue === true && !section.visible
  return (
    <tr className={cn('border-b border-slate-100 last:border-b-0', inert && 'bg-amber-50/60')}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {section.visible
            ? <Eye className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            : <EyeOff className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
          <div>
            <div className={cn('font-bold', section.visible ? 'text-slate-900' : 'text-slate-400')}>
              {section.brandLabel && <span className="text-slate-400">{section.brandLabel} · </span>}
              {section.sectionName}
            </div>
            <div className="font-mono text-[10px] text-slate-400">{section.href || section.sectionKey}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={cn('inline-block rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]', style.className)}>
          {style.label}
        </span>
        {inert && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-amber-900">
            <AlertTriangle className="h-3 w-3" /> Inert
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-[11px] leading-relaxed text-slate-600">{section.explanation}</td>
    </tr>
  )
}

export function EffectiveAccessClient() {
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')

  const { data: userData } = useQuery<{ users: UserRow[] }>({
    queryKey: ['effective-access-users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/effective-access')
      if (!res.ok) throw new Error('Failed to load users')
      return res.json()
    },
  })

  const { data: report, isFetching, error } = useQuery<EffectiveAccessReport>({
    queryKey: ['effective-access', selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const res = await fetch(`/api/admin/effective-access?userId=${encodeURIComponent(selectedId)}`)
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to resolve access')
      return res.json()
    },
  })

  const term = search.trim().toLowerCase()
  const people = (userData?.users || []).filter((u) =>
    !term || `${u.fullName || ''} ${u.email} ${u.role}`.toLowerCase().includes(term))

  return (
    <MainLayout title="Effective Access" subtitle="Why a user can or cannot see each section">
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or role" className="h-10 rounded-xl pl-9 text-xs" />
          </div>
          <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
            {people.map((u) => (
              <button key={u.id} onClick={() => setSelectedId(u.id)}
                className={cn('block w-full border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50',
                  selectedId === u.id && 'bg-indigo-50 hover:bg-indigo-50')}>
                <div className="truncate text-xs font-bold text-slate-900">{u.fullName || u.email}</div>
                <div className="truncate text-[10px] text-slate-500">{u.role}{u.brand ? ` · ${u.brand}` : ''}{u.isActive ? '' : ' · inactive'}</div>
              </button>
            ))}
            {!people.length && <div className="px-3 py-6 text-center text-xs text-slate-400">No users match.</div>}
          </div>
        </div>

        <div className="space-y-4">
          {!selectedId && (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">
              Pick a user to see exactly which sections they can reach, and why.
            </div>
          )}
          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{(error as Error).message}</div>}
          {isFetching && selectedId && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Resolving…</div>}

          {report && !isFetching && (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="text-sm font-black text-slate-900">{report.user.fullName || report.user.email}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {report.user.email} · {report.user.role}{report.user.brand ? ` · ${report.user.brand}` : ''}
                  {report.isSuperAdmin && ' · super admin'}
                  {!report.user.isActive && ' · INACTIVE'}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700">{report.summary.visible} visible</span>
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">{report.summary.hidden} hidden</span>
                  <span className="rounded-lg bg-sky-50 px-2.5 py-1 text-sky-700">{report.summary.explicitGrants} explicit grants</span>
                  <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-rose-700">{report.summary.explicitDenies} explicit denies</span>
                  {report.summary.inertGrants > 0 && (
                    <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-amber-900">
                      {report.summary.inertGrants} INERT grant{report.summary.inertGrants === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {report.summary.inertGrants > 0 && (
                  <p className="mt-2 text-[11px] font-semibold text-amber-800">
                    Ticked in the Access Map but withheld by the resolver — these buy this user nothing.
                  </p>
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">
                        <th className="px-4 py-2.5">Section</th>
                        <th className="px-4 py-2.5">Source</th>
                        <th className="px-4 py-2.5">Why</th>
                      </tr>
                    </thead>
                    <tbody>{report.sections.map((s) => <SectionRow key={s.sectionKey} section={s} />)}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </MainLayout>
  )
}
