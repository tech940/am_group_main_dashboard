'use client'

import { ChevronDown, Menu, LogOut, User, Mail, Loader2, Moon, Sun, Search, Palette, Check, Home } from 'lucide-react'
import { useSidebar } from '@/context/sidebar-context'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useMemo, useState, useEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { GlobalSearchDialog } from './global-search-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const THEME_CHANGE_EVENT = 'dashboard-theme-change'
const ACCENT_CHANGE_EVENT = 'dashboard-accent-change'

const ACCENT_THEMES = [
  { id: 'executive-navy', name: 'Executive Navy', color: '#031430', gradient: 'linear-gradient(135deg, #031430 0%, #0B2A55 100%)' },
  { id: 'tropical-teal', name: 'Tropical Teal', color: '#0D9488', gradient: 'linear-gradient(135deg, #055B65 0%, #2f8f83 100%)' },
] as const



function subscribeToThemeChanges(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  window.addEventListener('storage', callback)
  window.addEventListener(THEME_CHANGE_EVENT, callback)

  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(THEME_CHANGE_EVENT, callback)
  }
}

function getThemeSnapshot() {
  if (typeof document === 'undefined') {
    return false
  }

  return document.documentElement.classList.contains('dark')
}

function getThemeServerSnapshot() {
  return false
}


interface UserData {
  id: string
  email: string
  fullName: string
  role: string
}

interface HeaderProps {
  title?: string
  subtitle?: string
}

export function Header({ title = 'Dashboard', subtitle = 'Operational Monitoring' }: HeaderProps = {}) {
  const { collapsed, setCollapsed } = useSidebar()
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const isDarkMode = useSyncExternalStore(
    subscribeToThemeChanges,
    getThemeSnapshot,
    getThemeServerSnapshot
  )


  const { data: userData, isLoading: loading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async () => {
      const response = await fetch('/api/auth/user', { credentials: 'same-origin' })
      if (!response.ok) return null
      return await response.json()
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })
  const user = useMemo<UserData | null>(() => {
    if (!userData) return null
    return {
      id: userData.id,
      email: userData.email,
      fullName: userData.fullName,
      role: userData.role,
    }
  }, [userData])

  const handleLogout = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      queryClient.clear()
      await supabase.auth.signOut()
      router.push('/auth/login')
      router.refresh()
    } catch (error) {
      console.error('Error logging out:', error)
      setSigningOut(false)
    }
  }

  const [activeAccent, setActiveAccent] = useState<string>('executive-navy')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('dashboard-accent') || 'executive-navy'
      setActiveAccent(stored)
    }
  }, [])

  const changeAccent = (accentId: string) => {
    setActiveAccent(accentId)
    document.documentElement.setAttribute('data-dashboard-accent', accentId)
    window.localStorage.setItem('dashboard-accent', accentId)
    window.dispatchEvent(new Event(ACCENT_CHANGE_EVENT))
  }

  const toggleDarkMode = () => {
    const nextValue = !document.documentElement.classList.contains('dark')

    document.documentElement.classList.toggle('dark', nextValue)
    window.localStorage.setItem('dashboard-theme', nextValue ? 'dark' : 'light')
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }



  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'text-[var(--dashboard-primary)] bg-[var(--dashboard-primary-soft)] border-[var(--dashboard-primary-border)]'
      case 'manager':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'technician':
        return 'text-orange-600 bg-orange-50 border-orange-200'
      default:
        return 'text-slate-600 bg-slate-50 border-slate-200'
    }
  }

  return (
    <header className="sticky top-0 z-30 mx-4 sm:mx-5 mt-4 flex h-[72px] items-center justify-between rounded-[28px] border border-[color-mix(in_srgb,var(--dashboard-primary-border)_80%,transparent)] bg-[linear-gradient(135deg,#ffffff_0%,var(--dashboard-primary-soft)_48%,#eff6ff_100%)] px-3 sm:px-6 transition-colors dark:border-white/10 dark:bg-[linear-gradient(135deg,#020617_0%,var(--dashboard-primary-dark)_52%,#0f172a_100%)]">
      <div className="flex items-center gap-3 sm:gap-6">
        {/* Hamburger */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dashboard-primary-border)] bg-white text-slate-700 shadow-sm transition-all hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/16 dark:hover:text-blue-200"
        >
          <Menu className="h-6 w-6" />
        </button>
 
        {/* Section Title */}
        <div className="hidden lg:block">
          <h1 className="text-xl font-semibold leading-none text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[color-mix(in_srgb,var(--dashboard-primary)_70%,transparent)] dark:text-blue-200/70">{subtitle}</p>
        </div>
      </div>

      {/* Search Bar & Home Button Container */}
      <div className="flex items-center gap-2 mx-4 hidden md:flex flex-1 max-w-[420px] lg:max-w-[540px]">
        <Link
          href="/dashboard"
          className="flex h-11 items-center gap-2 rounded-[14px] border border-slate-300 bg-white px-3.5 text-[13px] font-bold text-slate-700 shadow-md transition-all hover:border-slate-400 hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100 shrink-0"
          title="Go to Home Page"
        >
          <Home className="h-4.5 w-4.5 text-[var(--dashboard-primary)]" />
          <span>Home</span>
        </Link>

        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-500 dark:text-slate-400" />
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-11 w-full items-center justify-between rounded-[14px] border border-slate-300 bg-white pl-10 pr-3.5 text-[13px] font-semibold text-slate-700 shadow-md transition-all hover:border-slate-400 hover:text-slate-900 hover:shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
          >
            <span>Search sections...</span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Ctrl+K
            </span>
          </button>
        </div>
      </div>
 
      <div className="flex items-center gap-3 sm:gap-8">
        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Mobile Home button */}
          <Link
            href="/dashboard"
            aria-label="Home page"
            title="Home page"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dashboard-primary-border)] bg-white text-slate-700 shadow-sm transition-all hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] md:hidden dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/16"
          >
            <Home className="h-5 w-5 text-[var(--dashboard-primary)]" />
          </Link>
          {/* Mobile search button */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search sections"
            title="Search sections"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dashboard-primary-border)] bg-white text-slate-700 shadow-sm transition-all hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] md:hidden dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/16"
          >
            <Search className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDarkMode ? 'Light mode' : 'Dark mode'}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dashboard-primary-border)] bg-white text-slate-700 shadow-sm transition-all hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] dark:border-white/10 dark:bg-white/10 dark:text-amber-200 dark:hover:bg-white/16 dark:hover:text-amber-100"
          >
            {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          {/* Theme Accent Picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Theme options"
                title="Change theme accent color"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dashboard-primary-border)] bg-white text-slate-700 shadow-sm transition-all hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] dark:border-white/10 dark:bg-white/10 dark:text-emerald-300 dark:hover:bg-white/16"
              >
                <Palette className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-2xl border-slate-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-slate-950">
              <DropdownMenuLabel className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400">
                Theme Color Palette
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-100 dark:bg-white/10" />
              {ACCENT_THEMES.map((theme) => {
                const isSelected = activeAccent === theme.id
                return (
                  <DropdownMenuItem
                    key={theme.id}
                    onClick={() => changeAccent(theme.id)}
                    className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="h-4 w-4 rounded-full shadow-inner border border-white/50 shrink-0" style={{ background: theme.gradient }} />
                      <span className={isSelected ? 'text-[var(--dashboard-primary)] font-extrabold' : 'text-slate-700 dark:text-slate-200'}>
                        {theme.name}
                      </span>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-[var(--dashboard-primary)] shrink-0" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex cursor-pointer items-center gap-1.5 sm:gap-3 border-l border-slate-200/70 pl-3 sm:pl-6 transition-opacity hover:opacity-85 dark:border-white/10">
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border-2 border-white/80 bg-[linear-gradient(135deg,var(--dashboard-primary),var(--dashboard-primary-light))] text-sm font-bold text-white shadow-sm ring-1 ring-[color-mix(in_srgb,var(--dashboard-primary)_20%,transparent)]">
                  {loading ? '...' : user?.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="hidden md:flex flex-col">
                  <p className="text-xs font-semibold leading-none text-slate-900 dark:text-white">
                    {loading ? 'Loading...' : user?.fullName}
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-[color-mix(in_srgb,var(--dashboard-primary)_70%,transparent)] dark:text-blue-200/70">
                    {loading ? '...' : user?.role}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-2xl border-slate-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-slate-950">
              <DropdownMenuLabel className="p-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-[linear-gradient(135deg,var(--dashboard-primary),var(--dashboard-primary-light))] flex items-center justify-center text-white font-bold text-lg shadow-lg">
                    {user?.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-white">{user?.fullName}</p>
                    <p className="text-xs text-slate-500 font-semibold flex items-center gap-1 mt-1 dark:text-slate-300">
                      <Mail className="h-3 w-3" />
                      {user?.email}
                    </p>
                  </div>
                </div>
                <div className={`mt-3 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 border ${getRoleBadgeColor(user?.role || '')}`}>
                  <User className="h-3 w-3" />
                  {user?.role}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-100 dark:bg-white/10" />
              <DropdownMenuItem
                onClick={handleLogout}
                disabled={signingOut}
                className="p-3 rounded-xl cursor-pointer text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold transition-colors"
              >
                {signingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {signingOut ? 'Signing out...' : 'Sign Out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  )
}
