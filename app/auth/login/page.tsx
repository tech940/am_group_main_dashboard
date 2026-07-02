'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, KeyRound, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const AM_GROUP_LOGO_URL = 'https://amgroupind.com/wp-content/uploads/2023/06/logo-1.png'
const BACKGROUND_IMAGE_URL = '/assets/login_bg_car.png'

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
        headers: {
          'Content-Type': 'application/json',
        },
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
      if (shouldResetLoading) {
        setLoading(false)
      }
    }
  }

  return (
    <main className="relative min-h-screen w-full flex items-center justify-center p-4 overflow-hidden font-sans">
      
      {/* Dynamic Background Image of sleek car */}
      <div 
        className="absolute inset-0 bg-cover bg-center transition-transform duration-[20s] scale-105 animate-pulse" 
        style={{ 
          backgroundImage: `url(${BACKGROUND_IMAGE_URL})`,
          animationDuration: '10s'
        }} 
      />

      {/* Layer 1: Soft Dark Blur Overlay to blend colors */}
      <div className="absolute inset-0 bg-slate-950/20 pointer-events-none" />

      {/* Layer 2: Soft tint overlay without blur to keep background image sharp and visible */}
      <div className="absolute inset-0 bg-gradient-to-tr from-teal-50/10 via-transparent to-blue-50/10 pointer-events-none" />

      {/* Subtle Dot Grid Overlay for technical texture */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      {/* Centered Glassmorphic Card */}
      <div className="relative z-10 w-full max-w-[480px] bg-white/90 backdrop-blur-2xl border border-white/80 rounded-[20px] shadow-[0_30px_100px_rgba(15,118,110,0.18)] p-8 sm:p-10 transition-all duration-300">
        
        {/* Header Branding */}
        <div className="flex flex-col items-center text-center space-y-4 mb-8">
          <div className="flex h-14 w-28 items-center justify-center rounded-none bg-slate-900 border border-slate-800 p-2.5 shadow-md">
            <img
              src={AM_GROUP_LOGO_URL}
              alt="AM Group Logo"
              className="h-10 w-full object-contain"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-[9px] font-black text-teal-600 uppercase tracking-[0.25em]">
              <Sparkles className="h-3 w-3" />
              Motors Operations
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Welcome Back</h2>
            <p className="text-xs text-slate-500 font-medium">
              Access the secure dashboard management console
            </p>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 rounded-2xl border border-rose-100 bg-rose-50/50 p-4 text-xs font-semibold text-rose-600 flex items-start gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} autoComplete="off" className="space-y-5">
          
          {/* Email Input */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              Corporate Email
            </Label>
            <div className="relative group">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-teal-600" />
              <Input
                id="email"
                type="email"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="name@amgroupind.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={loading}
                className="h-12 rounded-2xl border-slate-100 bg-slate-50/50 pl-11 text-sm text-slate-900 placeholder-slate-400 shadow-none focus:border-teal-500 focus:bg-white focus:ring-1 focus:ring-teal-500/30 transition-all font-medium"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Security Password
              </Label>
              <span className="text-[10px] font-extrabold text-teal-600 uppercase tracking-wider flex items-center gap-1">
                <KeyRound className="h-3 w-3" />
                Secure
              </span>
            </div>
            <div className="relative group">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-teal-600" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                placeholder="••••••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={loading}
                className="h-12 rounded-2xl border-slate-100 bg-slate-50/50 pl-11 pr-12 text-sm text-slate-900 placeholder-slate-400 shadow-none focus:border-teal-500 focus:bg-white focus:ring-1 focus:ring-teal-500/30 transition-all font-medium"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                disabled={loading}
                className="absolute right-3.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-teal-600 hover:bg-slate-100 transition-colors disabled:cursor-not-allowed"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Sign In Button */}
          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full mt-2 rounded-2xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-sm font-black text-white transition-all hover:scale-[1.01] hover:shadow-[0_8px_25px_rgba(13,148,136,0.18)] select-none"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
                Connecting...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                Sign In
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </Button>
        </form>

        {/* Security Audit Tip Panel */}
        <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50/40 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 border border-teal-100/50 shadow-sm">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-black text-slate-800">Protected Workspace</p>
              <p className="text-[11px] leading-relaxed text-slate-500 font-medium">
                Authorized credentials only. Access activities are logged and monitored.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Elegant Footer Signature */}
      <div className="absolute bottom-4 left-0 right-0 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest pointer-events-none z-10">
        AM Group Operations Portal
      </div>

    </main>
  )
}

function AlertCircle(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
