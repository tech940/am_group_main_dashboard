'use client'

import * as React from 'react'
import type { ToastVariant } from '@/components/ui/toast'

type ToastOptions = {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

type ToastEntry = ToastOptions & { id: string; open: boolean }

type ToastContextValue = {
  toasts: ToastEntry[]
  toast: (options: ToastOptions) => void
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

let externalToast: ((options: ToastOptions) => void) | null = null

export function ToastContextProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastEntry[]>([])

  const toast = React.useCallback((options: ToastOptions) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...options, id, open: true }])
    const duration = options.duration ?? 4000
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)))
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300)
    }, duration)
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300)
  }, [])

  React.useEffect(() => {
    externalToast = toast
    return () => { externalToast = null }
  }, [toast])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastContextProvider')
  return ctx
}

/** Call this from anywhere (outside React tree) after the provider is mounted */
export function toast(options: ToastOptions) {
  if (externalToast) {
    externalToast(options)
  } else {
    console.warn('[toast] called before ToastContextProvider mounted')
  }
}
