'use client'

import { Lock, Car, BarChart3, ShieldCheck } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'

export default function DashboardPage() {
  return (
    <MainLayout title="Dashboard" subtitle="Coming Soon">
      <section className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
        <div className="relative w-full overflow-hidden rounded-[32px] border border-teal-100 bg-white p-8 text-center shadow-[0_28px_90px_rgba(15,118,110,0.12)] sm:p-12">
          <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-teal-600 via-cyan-500 to-blue-600" />
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-100/70 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -right-24 h-80 w-80 rounded-full bg-blue-100/80 blur-3xl" />

          <div className="relative z-10 mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-teal-100 bg-gradient-to-br from-teal-50 to-blue-50 text-teal-700 shadow-inner">
            <Lock className="h-9 w-9" />
          </div>

          <div className="relative z-10 mt-8">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-teal-700">
              Locked Preview
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              Main Dashboard Coming Soon
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base font-medium leading-7 text-slate-600">
              This area is reserved for the live company-wide vehicle operations dashboard. The previous placeholder metrics have been hidden so users do not confuse demo data with real performance.
            </p>
          </div>

          <div className="relative z-10 mt-10 grid gap-4 text-left md:grid-cols-3">
            {[
              {
                title: 'Vehicle Operations',
                text: 'Buying, selling, inventory, and branch performance summaries.',
                icon: Car,
              },
              {
                title: 'Executive Metrics',
                text: 'Approved KPIs, trends, and alerts will be added once validated.',
                icon: BarChart3,
              },
              {
                title: 'Production Data Only',
                text: 'Live sections remain Business Excellence and Purchase Orders.',
                icon: ShieldCheck,
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 shadow-sm"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm">
                  <item.icon className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-black text-slate-900">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MainLayout>
  )
}
