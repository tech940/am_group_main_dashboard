'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, IndianRupee, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const AM_GROUP_LOGO_URL = 'https://amgroupind.com/wp-content/uploads/2023/06/logo-1.png'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        setError(result?.error || 'Unable to sign in')
        return
      }

      shouldResetLoading = false
      router.replace(result?.redirectTo || '/dashboard')
      router.refresh()
    } catch (err) {
      setError('Unable to reach the login service. Please check your connection and try again.')
      console.error(err)
    } finally {
      if (shouldResetLoading) {
        setLoading(false)
      }
    }
  }

  return (
    <main className="relative min-h-screen bg-slate-950 p-2 text-slate-950 sm:p-3 lg:h-screen lg:overflow-hidden">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
          <div className="rounded-3xl border border-white/15 bg-white px-8 py-6 text-center shadow-2xl">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-teal-700" />
            <p className="mt-4 text-sm font-black text-slate-950">Signing you in</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">Preparing your dashboard session...</p>
          </div>
        </div>
      )}
      <div className="grid min-h-[calc(100vh-1rem)] overflow-hidden rounded-[1.5rem] bg-white shadow-2xl sm:min-h-[calc(100vh-1.5rem)] lg:h-[calc(100vh-1.5rem)] lg:min-h-0 lg:grid-cols-[1fr_0.9fr]">
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-teal-900 via-emerald-800 to-slate-950 p-8 text-white lg:flex lg:flex-col lg:justify-center">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(45,212,191,0.24),transparent_28%),radial-gradient(circle_at_80%_15%,rgba(16,185,129,0.2),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.1),rgba(15,23,42,0.55))]" />
          <div className="absolute -right-24 top-24 h-72 w-72 rounded-full border border-white/10" />
          <div className="absolute -bottom-28 left-20 h-80 w-80 rounded-full border border-emerald-300/10" />

          <div className="relative z-10 max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="flex h-12 w-16 items-center justify-center rounded-xl bg-slate-900 px-2">
                <img
                  src={AM_GROUP_LOGO_URL}
                  alt="AM Group"
                  className="h-8 w-full object-contain"
                />
              </div>
              <div>
                <p className="text-sm font-black tracking-wide">AM Group</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-100/80">Motors Management</p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="inline-flex rounded-full border border-emerald-200/20 bg-emerald-300/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-emerald-100">
                Motors management hub
              </p>
              <h1 className="max-w-2xl text-5xl font-black leading-[0.95] tracking-tight xl:text-6xl">
                Run every vehicle workflow from one dashboard.
              </h1>
              <p className="max-w-xl text-sm leading-6 text-emerald-50/85 xl:text-base">
                Manage vehicle buying, selling, inventory, approvals, branches, and accounts from one secure operations desk.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur-md">
                <Building2 className="mb-3 h-5 w-5 text-emerald-100" />
                <p className="text-2xl font-black">8</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100/70">Branches</p>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur-md">
                <IndianRupee className="mb-3 h-5 w-5 text-emerald-100" />
                <p className="text-2xl font-black">Live</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100/70">Motor Deals</p>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/10 p-4 backdrop-blur-md">
                <ShieldCheck className="mb-3 h-5 w-5 text-emerald-100" />
                <p className="text-2xl font-black">Secure</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-emerald-100/70">Approvals</p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-1rem)] items-center justify-center bg-white px-6 py-8 sm:px-10 lg:min-h-0 lg:py-6">
          <div className="w-full max-w-md">
            <div className="mb-6 lg:hidden">
              <div className="inline-flex items-center gap-3 rounded-2xl bg-slate-900 px-3 py-3">
                <img
                  src={AM_GROUP_LOGO_URL}
                  alt="AM Group"
                  className="h-9 w-20 object-contain"
                />
                <span className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100">Motors</span>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-700">AM Group Dashboard</p>
              <h2 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Welcome back</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Sign in to manage motor sales, purchases, inventory, branches, approvals, and accounts workflows.
              </p>
            </div>

            <form onSubmit={handleLogin} autoComplete="off" className="space-y-4">
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 animate-in fade-in slide-in-from-top-2 duration-300">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-black uppercase tracking-widest text-slate-500">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="your.email@amgroup.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={loading}
                    className="h-12 rounded-2xl border-slate-200 bg-slate-50 pl-11 text-base shadow-none focus:border-emerald-600 focus:bg-white focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-black uppercase tracking-widest text-slate-500">
                    Password
                  </Label>
                  <span className="text-xs font-bold text-emerald-700">Secure access</span>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="off"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    disabled={loading}
                    className="h-12 rounded-2xl border-slate-200 bg-slate-50 pl-11 text-base shadow-none focus:border-emerald-600 focus:bg-white focus:ring-emerald-600"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-700 text-base font-black text-white shadow-lg shadow-emerald-900/15 transition-all hover:from-teal-800 hover:to-emerald-800 hover:shadow-xl"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-800">Persistent secure session</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    You will stay signed in on this browser until logout or security expiry.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

// Made with Bob
