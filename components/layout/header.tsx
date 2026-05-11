'use client'

import { Bell, Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Header() {
  return (
    <header className="sticky top-0 z-40 flex h-24 items-center justify-between px-10 bg-background/50 backdrop-blur-xl">
      {/* Search */}
      <div className="relative w-[450px]">
        <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input 
          type="text" 
          placeholder="Search..." 
          className="w-full h-12 pl-12 pr-4 rounded-2xl bg-white border-none shadow-sm text-sm font-semibold placeholder:text-slate-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all"
        />
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-white shadow-sm hover:bg-slate-50 relative group transition-all duration-300">
          <Bell className="h-5 w-5 text-slate-500 group-hover:text-purple-600 transition-colors" />
          <div className="absolute top-3.5 right-3.5 h-2 w-2 rounded-full bg-rose-500 border-2 border-white shadow-sm" />
        </Button>
        
        <div className="flex items-center gap-3 pl-6 ml-2 border-l border-slate-200">
          <div className="h-11 w-11 rounded-2xl bg-slate-200 overflow-hidden shadow-sm border-2 border-white ring-1 ring-slate-100">
            <img 
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Emma" 
              alt="Avatar" 
              className="h-full w-full object-cover"
            />
          </div>
          <div className="hidden md:flex items-center gap-2 cursor-pointer group">
            <div className="text-left">
              <p className="text-sm font-black text-slate-800 leading-none">Emma Kwan</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">Administrator</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          </div>
        </div>
      </div>
    </header>
  )
}
