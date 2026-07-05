'use client'

import { useToast } from '@/hooks/use-toast'
import { ToastProvider, ToastViewport, Toast } from '@/components/ui/toast'

export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <ToastProvider>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          open={t.open}
          onOpenChange={(open) => { if (!open) dismiss(t.id) }}
          variant={t.variant}
          title={t.title}
          description={t.description}
          duration={t.duration ?? 4000}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
