'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  BarChart3,
  Building2,
  Calculator,
  Car,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const BRAND_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'

const ORBIT_NODES = [
  { label: 'Service AI', icon: Car, color: '#45d35d', bg: '#effff3', angle: 0, ring: 214 },
  { label: 'Retail AI', icon: Sparkles, color: '#7c4dff', bg: '#f5efff', angle: 60, ring: 238 },
  { label: 'Accounting AI', icon: Calculator, color: '#18c88e', bg: '#ecfff8', angle: 125, ring: 224 },
  { label: 'Analytics AI', icon: BarChart3, color: '#f5b400', bg: '#fff8df', angle: 180, ring: 238 },
  { label: 'Parts AI', icon: Settings, color: '#2aa0ff', bg: '#eef7ff', angle: 235, ring: 222 },
  { label: 'Inventory AI', icon: Building2, color: '#3d7ef2', bg: '#edf4ff', angle: 300, ring: 238 },
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

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    let shouldResetLoading = true

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        setError(result?.error || 'Invalid email or password. Please try again.')
        return
      }

      shouldResetLoading = false
      router.replace(result?.redirectTo || '/dashboard')
      router.refresh()
    } catch (err) {
      setError('Connection failed. Please check your network and try again.')
      console.error(err)
    } finally {
      if (shouldResetLoading) setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f8fd] px-4 py-4 text-slate-950 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_88%,rgba(180,210,255,0.45),transparent_24%),radial-gradient(circle_at_95%_92%,rgba(199,231,255,0.52),transparent_24%),linear-gradient(135deg,#fbfcff_0%,#f4f7fd_47%,#eef4fb_100%)]" />
      <div className="pointer-events-none absolute -bottom-28 -left-28 h-80 w-80 rounded-full border border-white/90 bg-[radial-gradient(circle,rgba(255,255,255,0.95)_1px,transparent_2px)] bg-[length:16px_16px] opacity-70" />
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full border border-white/80 bg-white/30 blur-3xl" />

      <section className="relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1420px] flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/48 shadow-[0_24px_90px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:min-h-[calc(100vh-3rem)] lg:flex-row">
        <div className="relative hidden min-h-[760px] flex-1 overflow-hidden px-10 py-9 lg:block xl:px-14">
          <div className="absolute left-10 top-9 z-30 xl:left-14">
            <div className="flex items-center gap-3">
              <img
                src={BRAND_LOGO_URL}
                alt="AM Group"
                className="h-[104px] w-auto object-contain mix-blend-multiply"
              />
            </div>
          </div>

          <div className="absolute left-1/2 top-1/2 h-[660px] w-[660px] -translate-x-1/2 -translate-y-1/2">
            <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/70" />
            <div className="absolute left-1/2 top-1/2 h-[466px] w-[466px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/70" />
            <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-slate-200/80 animate-[spin_120s_linear_infinite]" />

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

            <div className="absolute left-1/2 top-1/2 flex h-52 w-52 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white bg-white/92 shadow-[0_20px_60px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]">
              <img src={BRAND_LOGO_URL} alt="AM Group" className="h-[90%] w-[90%] rounded-full object-contain" />
            </div>

            <div className="absolute inset-0 animate-[spin_120s_linear_infinite]">
              {ORBIT_NODES.map((node) => {
                const Icon = node.icon

                  return (
                    <div
                      key={node.label}
                      className="absolute left-1/2 top-1/2 group cursor-pointer"
                      style={{ transform: orbitTransform(node.angle, node.ring) }}
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

              {ORBIT_DOTS.map((dot) => (
                <span
                  key={`${dot.angle}-${dot.ring}`}
                  className="absolute left-1/2 top-1/2 rounded-full shadow-[0_0_18px_currentColor]"
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

        <div className="relative flex w-full items-center justify-center px-5 py-8 sm:px-8 lg:w-[520px] lg:px-10 xl:w-[600px]">
          <div className="absolute inset-y-10 left-0 hidden w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent lg:block" />

          <div className="w-full max-w-[460px] rounded-[2rem] border border-white/90 bg-white/92 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-9">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <img
                src={BRAND_LOGO_URL}
                alt="AM Group"
                className="h-12 w-auto object-contain mix-blend-multiply"
              />
            </div>

            <div className="mt-2 flex flex-col items-start text-left">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#eaf2ff] px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#1f56a8] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                AM Group Dashboard
              </div>
              <h1 className="mt-6 text-4xl font-black tracking-[-0.045em] text-[#101936] sm:text-5xl">Welcome back</h1>
              <p className="mt-4 max-w-sm text-base font-medium leading-7 text-slate-500">
                Sign in to manage your operations across all branches.
              </p>
            </div>

            {error && (
              <div className="mt-6 flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600 shadow-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleLogin} autoComplete="off" className="mt-8 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="off"
                    autoCapitalize="none"
                    placeholder="your.email@amgroupind.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    className="h-14 rounded-2xl border-slate-200/90 bg-white pl-12 pr-4 text-base font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.04)] placeholder:text-sm placeholder:font-medium placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="password" className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    Password
                  </Label>
                  <button
                    type="button"
                    className="text-xs font-bold text-emerald-500 transition-colors hover:text-emerald-600"
                    disabled={loading}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="h-14 rounded-2xl border-slate-200/90 bg-white pl-12 pr-12 text-base font-semibold text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.04)] placeholder:text-sm placeholder:font-medium placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    disabled={loading}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  backgroundImage: 'linear-gradient(90deg,#36d27b 0%,#19c7aa 50%,#45d34f 100%)',
                }}
                className="flex h-14 w-full items-center justify-center rounded-2xl text-base font-black text-white shadow-sm transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-80"
              >
                <span className="flex items-center justify-center gap-3">
                  {loading ? 'Signing in...' : 'Sign In'}
                  {!loading && <ArrowRight className="h-5 w-5" />}
                </span>
              </button>
            </form>

            <div className="mt-7 flex items-start gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                <ShieldCheck className="h-5 w-5 text-slate-500" strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800">Secure &amp; Reliable</p>
                <p className="mt-0.5 text-sm font-medium leading-6 text-slate-500">
                  Protected by enterprise-grade security and encrypted connections.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
