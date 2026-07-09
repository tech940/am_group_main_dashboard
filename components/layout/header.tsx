'use client'

import { ChevronDown, Menu, LogOut, User, Mail, Loader2, Moon, Sun } from 'lucide-react'
import { useSidebar } from '@/context/sidebar-context'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/components/layout/notification-bell'




const THEME_CHANGE_EVENT = 'dashboard-theme-change'



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
    <header className="sticky top-0 z-30 mx-5 mt-4 flex h-[72px] items-center justify-between rounded-[28px] border border-[color-mix(in_srgb,var(--dashboard-primary-border)_80%,transparent)] bg-[linear-gradient(135deg,#ffffff_0%,var(--dashboard-primary-soft)_48%,#eff6ff_100%)] px-6 transition-colors dark:border-white/10 dark:bg-[linear-gradient(135deg,#020617_0%,var(--dashboard-primary-dark)_52%,#0f172a_100%)]">
      <div className="flex items-center gap-6">
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

      <div className="flex items-center gap-8">
        {/* Right Actions */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDarkMode ? 'Light mode' : 'Dark mode'}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--dashboard-primary-border)] bg-white text-slate-700 shadow-sm transition-all hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-primary)] dark:border-white/10 dark:bg-white/10 dark:text-amber-200 dark:hover:bg-white/16 dark:hover:text-amber-100"
          >
            {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <NotificationBell userId={user?.id ?? null} userRole={user?.role ?? null} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex cursor-pointer items-center gap-3 border-l border-slate-200/70 pl-6 transition-opacity hover:opacity-85 dark:border-white/10">
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
    </header>
  )
}
