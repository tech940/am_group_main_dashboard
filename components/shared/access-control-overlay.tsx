'use client'

import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AccessControlOverlayProps {
  isLocked: boolean
  children: React.ReactNode
  message?: string
  className?: string
}

export function AccessControlOverlay({
  isLocked,
  children,
  message = "You don't have access to view this data",
  className
}: AccessControlOverlayProps) {
  if (!isLocked) {
    return <>{children}</>
  }

  return (
    <div className={cn("relative", className)}>
      {/* Blurred content */}
      <div className="blur-sm pointer-events-none select-none">
        {children}
      </div>
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px] flex items-center justify-center z-10">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4 border border-slate-200">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
              <Lock className="h-8 w-8 text-slate-600" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-800 mb-2">Access Restricted</h3>
              <p className="text-sm font-semibold text-slate-600">
                {message}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Made with Bob
