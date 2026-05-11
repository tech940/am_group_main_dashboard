'use client'

import { Bell, Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-24 items-center justify-between px-10 bg-slate-50/80 backdrop-blur-md border-b border-slate-100">
      {/* Search */}
      <div className="relative w-[400px]">
        <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input 
          type="text" 
          placeholder="Search..." 
          className="w-full h-11 pl-12 pr-4 rounded-xl bg-white border border-slate-200/50 shadow-sm text-sm font-medium placeholder:text-slate-400 focus:ring-2 focus:ring-purple-100 focus:border-purple-200 outline-none transition-all"
        />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl bg-white border border-slate-100 shadow-sm hover:bg-slate-50 relative group transition-all duration-300">
          <Bell className="h-5 w-5 text-slate-500 group-hover:text-purple-600 transition-colors" />
          <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-rose-500 border-2 border-white shadow-sm" />
        </Button>
        
        <div className="flex items-center gap-3 pl-6 ml-2 border-l border-slate-200">
          <div className="h-10 w-10 rounded-xl bg-slate-100 overflow-hidden shadow-sm border-2 border-white ring-1 ring-slate-200">
            <img 
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Emma" 
              alt="Avatar" 
              className="h-full w-full object-cover"
            />
          </div>
          <div className="hidden md:flex items-center gap-2 cursor-pointer group">
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-800 leading-none">Emma Kwan</p>
              <p className="text-[9px] font-bold text-slate-500 mt-1.5 uppercase tracking-widest">Administrator</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          </div>
        </div>
      </div>
    </header>
  )
}
