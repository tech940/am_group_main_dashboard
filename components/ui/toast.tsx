'use client'

import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'

const ToastProvider = ToastPrimitives.Provider
const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={`fixed bottom-4 right-4 z-[100] flex max-h-screen w-full max-w-[380px] flex-col-reverse gap-2 p-4 ${className ?? ''}`}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

const variantConfig: Record<ToastVariant, { icon: React.ReactNode; bg: string; border: string; title: string }> = {
  default: {
    icon: <Info className="h-4 w-4 text-slate-500" />,
    bg: 'bg-white',
    border: 'border-slate-200',
    title: 'text-slate-900',
  },
  success: {
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    bg: 'bg-white',
    border: 'border-emerald-200',
    title: 'text-emerald-900',
  },
  error: {
    icon: <AlertCircle className="h-4 w-4 text-rose-500" />,
    bg: 'bg-white',
    border: 'border-rose-200',
    title: 'text-rose-900',
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    bg: 'bg-white',
    border: 'border-amber-200',
    title: 'text-amber-900',
  },
  info: {
    icon: <Info className="h-4 w-4 text-blue-500" />,
    bg: 'bg-white',
    border: 'border-blue-200',
    title: 'text-blue-900',
  },
}

interface ToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> {
  variant?: ToastVariant
  title?: string
  description?: string
}

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  ToastProps
>(({ variant = 'default', title, description, ...props }, ref) => {
  const config = variantConfig[variant]
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={`group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border ${config.border} ${config.bg} p-4 shadow-[0_8px_32px_rgba(15,23,42,0.12)] backdrop-blur transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-full`}
      {...props}
    >
      <div className="mt-0.5 shrink-0">{config.icon}</div>
      <div className="flex-1 space-y-0.5">
        {title && (
          <ToastPrimitives.Title className={`text-sm font-black leading-tight ${config.title}`}>
            {title}
          </ToastPrimitives.Title>
        )}
        {description && (
          <ToastPrimitives.Description className="text-xs font-medium text-slate-500 leading-relaxed">
            {description}
          </ToastPrimitives.Description>
        )}
      </div>
      <ToastPrimitives.Close className="shrink-0 rounded-xl p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
        <X className="h-3.5 w-3.5" />
      </ToastPrimitives.Close>
    </ToastPrimitives.Root>
  )
})
Toast.displayName = 'Toast'

export { ToastProvider, ToastViewport, Toast }
export type { ToastVariant, ToastProps }
