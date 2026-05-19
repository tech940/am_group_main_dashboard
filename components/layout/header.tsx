'use client'

import { Search, ChevronDown, Menu, LogOut, User, Mail } from 'lucide-react'
import { useSidebar } from '@/context/sidebar-context'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/components/layout/notification-bell'

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
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/user', { cache: 'no-store' })

        if (!response.ok) {
          throw new Error('Failed to fetch current user')
        }

        const userData = await response.json()
        setUser({
          id: userData.id,
          email: userData.email,
          fullName: userData.fullName,
          role: userData.role
        })
      } catch (error) {
        console.error('Error fetching user:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      await supabase.auth.signOut()
      router.push('/auth/login')
      router.refresh()
    } catch (error) {
      console.error('Error logging out:', error)
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200'
      case 'manager':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'technician':
        return 'text-orange-600 bg-orange-50 border-orange-200'
      default:
        return 'text-slate-600 bg-slate-50 border-slate-200'
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between px-6 bg-white/80 backdrop-blur-md border-b border-slate-100">
      <div className="flex items-center gap-6">
        {/* Hamburger */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-10 w-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-all"
        >
          <Menu className="h-6 w-6" />
        </button>

        {/* Section Title */}
        <div className="hidden lg:block">
          <h1 className="text-xl font-semibold text-slate-800 leading-none">{title}</h1>
          <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-widest">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-8">
        {/* Search */}
        <div className="relative w-[300px] hidden xl:block">
          <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search dashboard..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-200/50 shadow-sm text-xs font-medium placeholder:text-slate-400 focus:ring-2 focus:ring-teal-100 outline-none transition-all"
          />
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-4">
          <NotificationBell userId={user?.id || null} />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-3 pl-6 border-l border-slate-200 cursor-pointer hover:opacity-80 transition-opacity">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 overflow-hidden border-2 border-white ring-1 ring-slate-200 shadow-sm flex items-center justify-center text-white font-bold text-sm">
                  {loading ? '...' : user?.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="hidden md:flex flex-col">
                  <p className="text-xs font-semibold text-slate-800 leading-none">
                    {loading ? 'Loading...' : user?.fullName}
                  </p>
                  <p className="text-[9px] font-bold text-slate-500 mt-1 uppercase tracking-widest">
                    {loading ? '...' : user?.role}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-2xl border-slate-200 shadow-2xl bg-white p-2">
              <DropdownMenuLabel className="p-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                    {user?.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-800">{user?.fullName}</p>
                    <p className="text-xs text-slate-500 font-semibold flex items-center gap-1 mt-1">
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
              <DropdownMenuSeparator className="bg-slate-100" />
              <DropdownMenuItem
                onClick={handleLogout}
                className="p-3 rounded-xl cursor-pointer text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold transition-colors"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
