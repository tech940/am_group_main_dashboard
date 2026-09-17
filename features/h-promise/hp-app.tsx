'use client'

import * as React from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { HPromiseTokens } from './hp-tokens'
import { RegPlate, Skeleton } from './hp-ui'

/**
 * The frame of the one H Promise page: the section header. Everything inside — the five forms, the tabs and
 * the vehicle drawer — is HPromiseApp (hp-home.tsx), streamed in once the register has loaded.
 */
export function HPromiseShell({ children }: { children: React.ReactNode }) {
  return (
    <MainLayout title="H Promise" subtitle="AM Tata · pre-owned car desk">
      <HPromiseTokens />
      <div className="hp mx-auto max-w-[1520px] space-y-4 pb-16">
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:px-5">
          <span className="hidden shrink-0 sm:inline-flex"><RegPlate label="H PROMISE" size="lg" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">AM Tata · Pre-owned</p>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">H Promise</h2>
            <p className="mt-0.5 text-sm text-slate-500">Purchase, booking, sale, documents and approvals for every pre-owned car.</p>
          </div>
        </div>
        {children}
      </div>
    </MainLayout>
  )
}

/** What shows while the register streams in. */
export function HPromiseLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading H Promise…</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16" />)}
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
