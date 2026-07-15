'use client'

import React, { useState, useEffect } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import {
  BarChart3,
  Building2,
  Calculator,
  Car,
  Settings,
  Sparkles,
  ShieldCheck,
  Database,
  Cpu,
  Fingerprint,
  Calendar,
  Layers
} from 'lucide-react'
import { cn } from '@/lib/utils'

const BRAND_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'

const ORBIT_NODES = [
  { label: 'Service Operations', icon: Car, color: '#45d35d', bg: '#effff3', angle: 0, ring: 190 },
  { label: 'Sales & Bookings', icon: Sparkles, color: '#7c4dff', bg: '#f5efff', angle: 60, ring: 210 },
  { label: 'Ledger Accounts', icon: Calculator, color: '#18c88e', bg: '#ecfff8', angle: 125, ring: 195 },
  { label: 'Business Analytics', icon: BarChart3, color: '#f5b400', bg: '#fff8df', angle: 180, ring: 210 },
  { label: 'System Configuration', icon: Settings, color: '#2aa0ff', bg: '#eef7ff', angle: 235, ring: 190 },
  { label: 'Branch Inventory', icon: Building2, color: '#3d7ef2', bg: '#edf4ff', angle: 300, ring: 210 },
]

const ORBIT_DOTS = [
  { angle: 18, ring: 240, color: '#6e7ff5', size: 6 },
  { angle: 82, ring: 245, color: '#5c43ee', size: 6 },
  { angle: 142, ring: 230, color: '#74d7b0', size: 6 },
  { angle: 180, ring: 250, color: '#ffbf26', size: 6 },
  { angle: 222, ring: 240, color: '#8492f5', size: 6 },
  { angle: 270, ring: 248, color: '#1fb7e8', size: 6 },
  { angle: 318, ring: 225, color: '#48c8c8', size: 6 },
  { angle: 0, ring: 135, color: '#43d45f', size: 6 },
]

interface UserSession {
  fullName: string
  email: string
  role: string
  brand: string
  department: string
}

function polarToXY(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: Math.cos(rad) * r,
    y: Math.sin(rad) * r,
  }
}

function orbitTransform(angle: number, ring: number) {
  const { x, y } = polarToXY(angle, ring)
  return `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px))`
}

export default function DashboardPortal() {
  const [session, setSession] = useState<UserSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/user')
        if (res.ok) {
          const data = await res.json()
          setSession({
            fullName: data.fullName || 'Associate',
            email: data.email || '',
            role: data.role || 'user',
            brand: data.brand || 'ALL',
            department: data.department || 'Operations',
          })
          setLoading(false)
          return
        }

        // Deactivated mid-session: the Supabase cookie is still valid, so the proxy keeps letting
        // them in here while every fetch 401s — they'd otherwise sit on this page with placeholder
        // data looking signed in, and the proxy blocks /auth/login while the cookie exists. End the
        // session properly instead. Stay in the loading state so the shell never flashes.
        const body = await res.json().catch(() => null)
        if (body?.code === 'account_inactive') {
          window.location.href = '/api/auth/logout?reason=inactive'
          return
        }
        setLoading(false)
      } catch (e) {
        console.error('Failed to load user session:', e)
        setLoading(false)
      }
    }
    fetchUser()
  }, [])

  if (loading) {
    return (
      <MainLayout title="Portal Gateway" subtitle="Resolving administrative context...">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Loading Operations Dashboard...</p>
        </div>
      </MainLayout>
    )
  }

  const roleLabel = session?.role 
    ? session.role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'Operator'

  return (
    <MainLayout title="Operations Hub" subtitle="AM Group Corporate Gateway & Status Command Center">
      <div className="relative mx-auto max-w-7xl px-4 py-6 pb-12">
        
        {/* Background Radial Orbs & Grid patterns from login page */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_8%_88%,rgba(180,210,255,0.25),transparent_24%),radial-gradient(circle_at_95%_92%,rgba(199,231,255,0.30),transparent_24%),linear-gradient(135deg,#fbfcff_0%,#f4f7fd_47%,#eef4fb_100%)] rounded-[2.5rem]" />
        
        <div className="relative flex flex-col overflow-hidden rounded-[2rem] border border-white/90 bg-white/48 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.06)] backdrop-blur-xl md:p-8 lg:flex-row lg:min-h-[680px] gap-8">
          
          {/* LEFT COLUMN: SPINNING ORBIT HUB */}
          <div className="relative flex-1 flex items-center justify-center min-h-[460px] lg:min-h-[580px] overflow-hidden select-none">
            
            <div className="absolute h-[520px] w-[520px] scale-90 sm:scale-100">
              {/* Concentric Circles */}
              <div className="absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/60" />
              <div className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/60" />
              <div className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-slate-200/70 animate-[spin_120s_linear_infinite]" />
              
              {/* Connection Lines */}
              <svg className="absolute inset-0 h-full w-full animate-[spin_120s_linear_infinite]" viewBox="0 0 520 520" aria-hidden="true">
                {ORBIT_NODES.map((node) => {
                  const outer = polarToXY(node.angle, node.ring - 30)
                  const inner = polarToXY(node.angle, 110)
                  return (
                    <line
                      key={node.label}
                      x1={260 + inner.x}
                      y1={260 + inner.y}
                      x2={260 + outer.x}
                      y2={260 + outer.y}
                      stroke="rgba(148, 163, 184, 0.18)"
                      strokeDasharray="5 8"
                      strokeLinecap="round"
                    />
                  )
                })}
              </svg>

              {/* Central Shield */}
              <div className="absolute left-1/2 top-1/2 flex h-40 w-40 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white bg-white/92 shadow-[0_15px_45px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]">
                <img src={BRAND_LOGO_URL} alt="AM Group" className="h-[82%] w-[82%] rounded-full object-contain" />
              </div>

              {/* Orbiting Nodes and Dots */}
              <div className="absolute inset-0 animate-[spin_120s_linear_infinite]">
                {ORBIT_NODES.map((node) => {
                  const Icon = node.icon
                  return (
                    <div
                      key={node.label}
                      className="absolute left-1/2 top-1/2"
                      style={{ transform: orbitTransform(node.angle, node.ring) }}
                    >
                      <div className="flex min-w-24 flex-col items-center gap-1.5 animate-[spin_120s_linear_infinite_reverse]">
                        <div
                          className="flex h-16 w-16 items-center justify-center rounded-full border border-white/95 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)] ring-1 ring-slate-100/70"
                        >
                          <Icon className="h-7 w-7" style={{ color: node.color }} strokeWidth={1.5} />
                        </div>
                        <span className="text-[11px] font-black tracking-tight text-slate-800 text-center uppercase">
                          {node.label.split(' ')[0]}
                        </span>
                      </div>
                    </div>
                  )
                })}

                {ORBIT_DOTS.map((dot, index) => (
                  <span
                    key={index}
                    className="absolute left-1/2 top-1/2 rounded-full shadow-[0_0_12px_currentColor]"
                    style={{
                      width: dot.size,
                      height: dot.size,
                      backgroundColor: dot.color,
                      color: dot.color,
                      transform: orbitTransform(dot.angle, dot.ring),
                    }}
                  />
                ))}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: STATIC STATUS BOARD & TELEMETRY */}
          <div className="w-full lg:w-[480px] xl:w-[520px] flex flex-col justify-center gap-6">
            
            {/* Header info */}
            <div className="text-left">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/5 dark:bg-white/5 border border-slate-900/10 dark:border-white/10 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-slate-800 dark:text-slate-200 select-none">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                Operations Command Live
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950 dark:text-white leading-none">
                Welcome back, {session?.fullName}
              </h1>
              <p className="mt-2.5 text-sm font-semibold text-slate-500">
                Administrative credentials verified. Connected as <span className="font-black text-slate-800 dark:text-slate-200">{roleLabel}</span> ({session?.department || 'Operations'} Department) for brand segment <span className="font-black text-indigo-600 dark:text-indigo-400">{session?.brand || 'ALL'}</span>.
              </p>
            </div>

            {/* Static Telemetry grid - completely non-interactive */}
            <div className="grid gap-4 sm:grid-cols-2 select-none">
              
              <div className="rounded-[1.5rem] border border-white/90 bg-white/92 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)] backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                    <Car className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sales Pipeline</p>
                    <p className="mt-0.5 text-xl font-black text-slate-900">234 Active</p>
                  </div>
                </div>
                <div className="mt-3.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: '64%' }} />
                </div>
                <p className="mt-2 text-[10px] font-semibold text-slate-400">Monthly booking conversion quota</p>
              </div>

              <div className="rounded-[1.5rem] border border-white/90 bg-white/92 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)] backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 border border-violet-100">
                    <Layers className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Active WIP</p>
                    <p className="mt-0.5 text-xl font-black text-slate-900">1,024 Cards</p>
                  </div>
                </div>
                <div className="mt-3.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: '78%' }} />
                </div>
                <p className="mt-2 text-[10px] font-semibold text-slate-400">Repair order workflow throughput</p>
              </div>

              <div className="rounded-[1.5rem] border border-white/90 bg-white/92 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)] backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <Database className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">System Integration</p>
                    <p className="mt-0.5 text-xl font-black text-emerald-700">100% Sync</p>
                  </div>
                </div>
                <div className="mt-3.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: '100%' }} />
                </div>
                <p className="mt-2 text-[10px] font-semibold text-slate-400">DMS & Postgres schema mirroring</p>
              </div>

              <div className="rounded-[1.5rem] border border-white/90 bg-white/92 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)] backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-100">
                    <Cpu className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Telemetry Gateway</p>
                    <p className="mt-0.5 text-xl font-black text-slate-900">Optimal</p>
                  </div>
                </div>
                <div className="mt-3.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: '85%' }} />
                </div>
                <p className="mt-2 text-[10px] font-semibold text-slate-400">API endpoints & latency metrics</p>
              </div>

            </div>

            {/* Bottom info banner */}
            <div className="flex items-start gap-3 rounded-[1.5rem] border border-slate-200/70 bg-slate-50/50 p-4 select-none">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 border border-slate-200">
                <ShieldCheck className="h-5 w-5 text-slate-500" strokeWidth={2} />
              </span>
              <div className="text-left">
                <p className="text-xs font-black uppercase tracking-wider text-slate-800">Operational Security Engaged</p>
                <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-slate-500">
                  This dashboard is a secure launch monitor. Access to database tables, repair records, and proformas is guarded via role matrix policies. Use the navigation sidebar to access authorized segments.
                </p>
              </div>
            </div>

          </div>

        </div>

        {/* Footer info */}
        <div className="mt-6 text-center text-xs text-slate-400 select-none">
          <p>© 2026 AM Group Holdings. System Integrity Optimal.</p>
        </div>

      </div>
    </MainLayout>
  )
}
