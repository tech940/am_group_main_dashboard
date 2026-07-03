'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Car,
  Building2,
  Tag,
  Settings,
  BarChart2,
  LayoutGrid,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const AM_GROUP_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.jpeg'

// Service nodes arranged around the orbital diagram
const ORBIT_NODES = [
  { label: 'Service AI',    icon: Car,        color: '#22c55e', bg: '#dcfce7', angle: 90  },
  { label: 'Retail AI',     icon: Tag,        color: '#a855f7', bg: '#f3e8ff', angle: 30  },
  { label: 'Accounting AI', icon: LayoutGrid, color: '#22c55e', bg: '#dcfce7', angle: 330 },
  { label: 'Analytics AI',  icon: BarChart2,  color: '#f97316', bg: '#ffedd5', angle: 270 },
  { label: 'Parts AI',      icon: Settings,   color: '#3b82f6', bg: '#dbeafe', angle: 210 },
  { label: 'Inventory AI',  icon: Building2,  color: '#3b82f6', bg: '#dbeafe', angle: 150 },
]

function polarToXY(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  const x = r * Math.cos(rad)
  const y = r * Math.sin(rad)
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
  }
}

function getTranslateStyle(x: number, y: number) {
  const xSign = x >= 0 ? '+' : '-'
  const ySign = y >= 0 ? '+' : '-'
  const xVal = Math.abs(x).toFixed(3)
  const yVal = Math.abs(y).toFixed(3)
  return `translate(calc(-50% ${xSign} ${xVal}px), calc(-50% ${ySign} ${yVal}px))`
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
    <div
      className="min-h-screen w-full flex items-stretch font-sans"
      style={{ background: 'linear-gradient(135deg, #eef0fb 0%, #f0f4ff 50%, #e8edf9 100%)' }}
    >
      {/* ─── Left: Orbital Diagram ─────────────────────────────────── */}
      <div className="hidden lg:flex flex-col flex-1 relative overflow-hidden p-10">
        {/* Top-left logo */}
        <div className="flex items-center gap-2.5 z-10 relative">
          <img src={AM_GROUP_LOGO_URL} alt="AM Group" className="h-9 w-auto object-contain" />
          <span className="text-sm font-black text-slate-800 tracking-wide uppercase">AM Group</span>
        </div>

        {/* Decorative background circles */}
        <div
          className="absolute"
          style={{
            width: 500,
            height: 500,
            borderRadius: '50%',
            border: '1px solid rgba(148,163,184,0.12)',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
        <div
          className="absolute"
          style={{
            width: 700,
            height: 700,
            borderRadius: '50%',
            border: '1px solid rgba(148,163,184,0.08)',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* Corner circuit decorations */}
        <svg className="absolute bottom-0 left-0 opacity-10" width="200" height="200" viewBox="0 0 200 200">
          <circle cx="0" cy="200" r="120" fill="none" stroke="#6366f1" strokeWidth="1" />
          <circle cx="0" cy="200" r="80"  fill="none" stroke="#6366f1" strokeWidth="1" />
          <circle cx="0" cy="200" r="40"  fill="none" stroke="#6366f1" strokeWidth="1" />
        </svg>
        <svg className="absolute top-0 right-0 opacity-10" width="160" height="160" viewBox="0 0 160 160">
          <circle cx="160" cy="0" r="100" fill="none" stroke="#6366f1" strokeWidth="1" />
          <circle cx="160" cy="0" r="60"  fill="none" stroke="#6366f1" strokeWidth="1" />
        </svg>

        {/* Center orbital */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative" style={{ width: 480, height: 480 }}>
            {/* Outer orbit ring */}
            <div
              className="absolute inset-0 rounded-full"
              style={{ border: '1.5px solid rgba(148,163,184,0.2)' }}
            />
            {/* Inner orbit ring */}
            <div
              className="absolute rounded-full"
              style={{
                border: '1.5px solid rgba(148,163,184,0.15)',
                inset: 80,
              }}
            />

            {/* Connection lines */}
            <svg className="absolute inset-0" width="480" height="480" viewBox="0 0 480 480">
              {ORBIT_NODES.map((node) => {
                const outer = polarToXY(node.angle, 220)
                const inner = polarToXY(node.angle, 80)
                return (
                  <line
                    key={node.label}
                    x1={240 + outer.x}
                    y1={240 + outer.y}
                    x2={240 + inner.x}
                    y2={240 + inner.y}
                    stroke="rgba(148,163,184,0.25)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                )
              })}
            </svg>

            {/* Center badge */}
            <div
              className="absolute flex flex-col items-center justify-center bg-white rounded-full shadow-lg"
              style={{
                width: 160,
                height: 160,
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <img src={AM_GROUP_LOGO_URL} alt="AM Group" className="h-27 w-29 object-contain" />
            </div>

            {/* Orbit nodes */}
            {ORBIT_NODES.map((node) => {
              const pos = polarToXY(node.angle, 220)
              const Icon = node.icon
              return (
                <div
                  key={node.label}
                  className="absolute flex flex-col items-center gap-1.5"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: getTranslateStyle(pos.x, pos.y),
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-2xl shadow-sm"
                    style={{
                      width: 52,
                      height: 52,
                      background: node.bg,
                    }}
                  >
                    <Icon style={{ color: node.color }} className="h-5 w-5" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">{node.label}</span>
                </div>
              )
            })}

            {/* Accent dots */}
            {[
              { angle: 60,  r: 270, color: '#22c55e' },
              { angle: 180, r: 265, color: '#6366f1' },
              { angle: 300, r: 260, color: '#f97316' },
              { angle: 240, r: 195, color: '#a855f7' },
              { angle: 0,   r: 185, color: '#3b82f6' },
            ].map((dot, i) => {
              const p = polarToXY(dot.angle, dot.r)
              return (
                <div
                  key={i}
                  className="absolute rounded-full"
                  style={{
                    width: 7,
                    height: 7,
                    background: dot.color,
                    left: '50%',
                    top: '50%',
                    transform: getTranslateStyle(p.x, p.y),
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── Right: Login Form ──────────────────────────────────────── */}
      <div className="flex items-center justify-center w-full lg:w-auto lg:min-w-[480px] xl:min-w-[520px] px-6 py-10 lg:px-14">
        <div className="w-full max-w-[420px] bg-white rounded-3xl shadow-[0_8px_48px_rgba(0,0,0,0.08)] p-8 sm:p-10">

          {/* Badge */}
          <div className="mb-5">
            <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
              AM Group Dashboard
            </span>
          </div>

          {/* Heading */}
          <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-slate-400 font-medium leading-relaxed">
            Sign in to manage your operations across all branches.
          </p>

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-semibold text-rose-600 flex items-start gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
              <span className="mt-0.5">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} autoComplete="off" className="mt-7 space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                Email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
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
                  className="h-11 rounded-xl border-slate-200 bg-white pl-11 text-sm text-slate-800 placeholder-slate-300 focus:border-green-400 focus:ring-1 focus:ring-green-400/30 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                  Password
                </Label>
                <span className="text-xs font-semibold text-green-500 cursor-pointer hover:text-green-600 transition-colors">
                  Forgot password?
                </span>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11 rounded-xl border-slate-200 bg-white pl-11 pr-12 text-sm text-slate-800 placeholder-slate-300 focus:border-green-400 focus:ring-1 focus:ring-green-400/30 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Sign In Button */}
            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl text-sm font-black text-white shadow-md transition-all hover:scale-[1.01] hover:shadow-lg select-none"
              style={{
                background: 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)',
              }}
            >
              <span className="flex items-center justify-center gap-2">
                {loading ? 'Signing in...' : 'Sign In'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </span>
            </Button>
          </form>

        </div>
      </div>
    </div>
  )
}
