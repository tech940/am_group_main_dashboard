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
  Search,
  ArrowRight,
  TrendingUp,
  Zap,
  ChevronRight,
  Receipt,
  Activity,
  Command,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight as ArrowRightIcon,
  MousePointerClick,
  Sliders,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const BRAND_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'

interface OrbitNode {
  label: string
  sublabel: string
  icon: React.ComponentType<any>
  color: string
  bg: string
  angle: number
  ring: number
}

const ORBIT_NODES = [
  { label: 'Service Operations', icon: Car, color: '#45d35d', bg: '#effff3', angle: 0, ring: 214 },
  { label: 'Sales & CRM', icon: Sparkles, color: '#7c4dff', bg: '#f5efff', angle: 60, ring: 238 },
  { label: 'Ledger Accounts', icon: Calculator, color: '#18c88e', bg: '#ecfff8', angle: 125, ring: 224 },
  { label: 'Business Analytics', icon: BarChart3, color: '#f5b400', bg: '#fff8df', angle: 180, ring: 238 },
  { label: 'System Configuration', icon: Settings, color: '#2aa0ff', bg: '#eef7ff', angle: 235, ring: 222 },
  { label: 'Branch Inventory', icon: Building2, color: '#3d7ef2', bg: '#edf4ff', angle: 300, ring: 238 },
]

const ORBIT_DOTS = [
  { angle: 18, ring: 272, color: '#6e7ff5', size: 8 },
  { angle: 82, ring: 278, color: '#5c43ee', size: 8 },
  { angle: 142, ring: 262, color: '#74d7b0', size: 8 },
  { angle: 180, ring: 285, color: '#ffbf26', size: 8 },
  { angle: 222, ring: 274, color: '#8492f5', size: 8 },
  { angle: 270, ring: 282, color: '#1fb7e8', size: 8 },
  { angle: 318, ring: 258, color: '#48c8c8', size: 8 },
  { angle: 0, ring: 158, color: '#43d45f', size: 8 },
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
  const [activeHoverNode, setActiveHoverNode] = useState<OrbitNode | null>(null)

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

  const triggerSearch = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  }

  if (loading) {
    return (
      <MainLayout title="Operations Hub" subtitle="Resolving administrative context...">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Loading Gateway...</p>
        </div>
      </MainLayout>
    )
  }

  const roleLabel = session?.role 
    ? session.role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'Operator'

  return (
    <MainLayout title="Operations Hub" subtitle="AM Group Corporate Gateway & Status Command Center">
      <div className="relative mx-auto max-w-7xl px-4 py-6 pb-16 space-y-8">
        
        {/* Background Radial Orbs & Ambient Gradient */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_10%_20%,rgba(99,102,241,0.06),transparent_30%),radial-gradient(circle_at_90%_80%,rgba(16,185,129,0.06),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#f1f5f9_50%,#e2e8f0_100%)] rounded-[2.5rem]" />
        
        {/* TOP HERO INFORMATIONAL BANNER */}
        <div className="relative flex flex-col gap-6 rounded-[2rem] border border-white/90 bg-white/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.05)] backdrop-blur-xl md:p-8">
          
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-sm select-none">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                AM GROUP CORPORATE GATEWAY · ACTIVE
              </div>
              <h1 className="mt-3.5 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                Welcome back, {session?.fullName}
              </h1>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600 max-w-2xl">
                Verified as <span className="font-extrabold text-slate-900">{roleLabel}</span> ({session?.department || 'Operations'} Department) for brand segment <span className="font-extrabold text-indigo-600">{session?.brand || 'ALL'}</span>. Use the search bar or shortcuts below to navigate to authorized sections.
              </p>
            </div>

            {/* Open Search Command CTA */}
            <button
              onClick={triggerSearch}
              className="group flex items-center gap-3 rounded-2xl border-2 border-indigo-600 bg-indigo-600 px-6 py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-xl hover:bg-indigo-700 hover:border-indigo-700 active:scale-95 transition-all cursor-pointer"
            >
              <Search className="h-4 w-4 text-white group-hover:scale-110 transition-transform" />
              <span>Search Sections</span>
              <kbd className="rounded-lg bg-indigo-800/80 px-2 py-1 text-[10px] font-mono text-indigo-100 shadow-inner">
                Ctrl + K
              </kbd>
            </button>
          </div>

        </div>

        {/* MAIN BODY: INTERACTIVE ANIMATED ORBIT (LEFT) + GESTURE & NAVIGATION GUIDES (RIGHT) */}
        <div className="relative flex flex-col overflow-hidden rounded-[2rem] border border-white/90 bg-white/70 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.06)] backdrop-blur-xl lg:flex-row lg:min-h-[600px] gap-8">
          
          {/* LEFT COLUMN: SPINNING ORBIT HUB (LOGIN PAGE MATCH) */}
          <div className="relative flex-1 flex items-center justify-center min-h-[520px] lg:min-h-[580px] overflow-hidden select-none">
            
            <div className="absolute h-[660px] w-[660px] scale-[0.75] sm:scale-85 md:scale-95 lg:scale-100">
              {/* Concentric Circles */}
              <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/70" />
              <div className="absolute left-1/2 top-1/2 h-[466px] w-[466px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/70" />
              <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-slate-200/80 animate-[spin_120s_linear_infinite]" />
              
              {/* Connection Lines */}
              <svg className="absolute inset-0 h-full w-full animate-[spin_120s_linear_infinite]" viewBox="0 0 660 660" aria-hidden="true">
                {ORBIT_NODES.map((node) => {
                  const outer = polarToXY(node.angle, node.ring - 40)
                  const inner = polarToXY(node.angle, 130)

                  return (
                    <line
                      key={node.label}
                      x1={330 + inner.x}
                      y1={330 + inner.y}
                      x2={330 + outer.x}
                      y2={330 + outer.y}
                      stroke="rgba(148, 163, 184, 0.22)"
                      strokeDasharray="5 8"
                      strokeLinecap="round"
                    />
                  )
                })}
              </svg>

              {/* Central Shield */}
              <div 
                onClick={triggerSearch}
                className="absolute left-1/2 top-1/2 flex h-52 w-52 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white bg-white/92 shadow-[0_20px_60px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.9)] cursor-pointer group hover:scale-105 transition-transform"
                title="Click to search dashboard sections"
              >
                <img src={BRAND_LOGO_URL} alt="AM Group" className="h-[90%] w-[90%] rounded-full object-contain" />
              </div>

              {/* Orbiting Nodes and Dots */}
              <div className="absolute inset-0 animate-[spin_120s_linear_infinite]">
                {ORBIT_NODES.map((node) => {
                  const Icon = node.icon

                  return (
                    <div
                      key={node.label}
                      className="absolute left-1/2 top-1/2 group cursor-pointer"
                      style={{ transform: orbitTransform(node.angle, node.ring) }}
                      onClick={triggerSearch}
                    >
                      <div className="relative flex h-[86px] w-[86px] flex-col items-center justify-center animate-[spin_120s_linear_infinite_reverse]">
                        <div
                          className="flex h-[86px] w-[86px] shrink-0 items-center justify-center rounded-full border border-white/95 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.07)] ring-1 ring-slate-100/70 transition-all duration-300 ease-out group-hover:scale-110 group-hover:shadow-[0_24px_56px_rgba(15,23,42,0.16)] group-hover:-translate-y-1"
                        >
                          <Icon className="h-10 w-10" style={{ color: node.color }} strokeWidth={1.5} />
                        </div>
                        <span className="absolute top-[94px] whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-slate-950 transition-all duration-300 group-hover:font-bold">
                          {node.label}
                        </span>
                      </div>
                    </div>
                  )
                })}

                {ORBIT_DOTS.map((dot, idx) => (
                  <span
                    key={idx}
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

          {/* RIGHT COLUMN: ANIMATED GESTURES & NAVIGATION GUIDES */}
          <div className="w-full lg:w-[480px] xl:w-[520px] flex flex-col justify-center gap-4">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Interactive Navigation Guide</h2>
              <span className="text-[10px] font-bold text-indigo-600 flex items-center gap-1">
                <Zap className="h-3 w-3 fill-indigo-600" /> Keyboard & Gesture Shortcuts
              </span>
            </div>

            {/* GUIDE CARD 1: Quick Search Shortcut (Ctrl + K) */}
            <div 
              onClick={triggerSearch}
              className="group cursor-pointer rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 group-hover:scale-105 transition-transform">
                    <Command className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-950">Quick Section Search</h3>
                    <p className="text-[11px] font-semibold text-slate-500">Instant jump to any section or feature</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-xl bg-slate-900 px-2.5 py-1 text-xs font-mono font-bold text-white shadow-sm group-hover:bg-indigo-600 transition-colors">
                  <span>Ctrl</span> + <span>K</span>
                </div>
              </div>
            </div>

            {/* GUIDE CARD 2: 2D Grid Arrow Navigation (↑ ↓ ← →) */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600">
                    <Sliders className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-950">2D Grid Arrow Navigation</h3>
                    <p className="text-[11px] font-semibold text-slate-500">Jump vertically and horizontally between cards</p>
                  </div>
                </div>
                
                {/* Animated D-Pad Indicator */}
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-slate-700 shadow-inner">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-white text-[10px] font-bold shadow-xs border border-slate-200">↑</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-white text-[10px] font-bold shadow-xs border border-slate-200">↓</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-white text-[10px] font-bold shadow-xs border border-slate-200">←</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-white text-[10px] font-bold shadow-xs border border-slate-200">→</span>
                </div>
              </div>
            </div>

            {/* GUIDE CARD 3: Cycle Department Filters (Tab Key) */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 border border-amber-100 text-amber-600">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-950">Cycle Department Filters</h3>
                    <p className="text-[11px] font-semibold text-slate-500">Switch views without leaving your keyboard</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-lg bg-amber-100 border border-amber-200 px-2 py-1 text-[10px] font-mono font-bold text-amber-900">Tab</span>
                  <span className="text-[10px] font-semibold text-slate-400">Sales → Service → Finance</span>
                </div>
              </div>
            </div>

            {/* GUIDE CARD 4: Role-Based Enterprise Security */}
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 shadow-xs">
                <ShieldCheck className="h-5 w-5 text-indigo-600" strokeWidth={2} />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-900">Strict Gating & Audit Trail Active</p>
                <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-slate-500">
                  Access to proformas, repair orders, and inventory is governed by your assigned role matrix policy.
                </p>
              </div>
            </div>

          </div>

        </div>

        {/* BOTTOM BRAND ARCHITECTURE & MODULES OVERVIEW */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          
          {/* KIA MODULE CARD */}
          <div className="kia-surface group relative flex flex-col justify-between overflow-hidden p-6 transition-all hover:shadow-xl border border-rose-100">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-1 text-xs font-black text-rose-700 uppercase tracking-widest">
                  KIA Segment
                </span>
                <Car className="h-6 w-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">KIA Motors Workflows</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">Complete end-to-end management for customer bookings, proforma approvals, free stock allocation, and demo car fleet control.</p>
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-bold text-slate-700">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Bookings CRM & Payment Tracking</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Stock Management & VIN Reservation</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Business Excellence & Service Appointments</span>
                </div>
              </div>
            </div>
          </div>

          {/* HYUNDAI MODULE CARD */}
          <div className="kia-surface group relative flex flex-col justify-between overflow-hidden p-6 transition-all hover:shadow-xl border border-sky-100">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-black text-sky-700 uppercase tracking-widest">
                  Hyundai Segment
                </span>
                <TrendingUp className="h-6 w-6 text-sky-500" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">Hyundai Workflows</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">Business Excellence analytics, daily repair order list, billing reports, claim YTP, and warranty tracking.</p>
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-bold text-slate-700">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Business Excellence & Daily RO Feed</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Hyundai Customer Bookings & Demo Cars</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Claim YTP & Warranty Claims Management</span>
                </div>
              </div>
            </div>
          </div>

          {/* CORPORATE & PLATINUM MODULE CARD */}
          <div className="kia-surface group relative flex flex-col justify-between overflow-hidden p-6 transition-all hover:shadow-xl border border-indigo-100">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs font-black text-indigo-700 uppercase tracking-widest">
                  Corporate & Admin
                </span>
                <Building2 className="h-6 w-6 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">Group Finance & Admin</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">Executive group cockpit summary, vendor payments, petty cash, purchase orders, and system governance.</p>
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs font-bold text-slate-700">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Group Executive Cockpit Dashboard</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Purchase Orders & Vendor Registry</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Admin Control & Delegation Tasks</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-slate-400 select-none">
          <p>© 2026 AM Group Holdings. System Integrity Optimal.</p>
        </div>

      </div>
    </MainLayout>
  )
}
