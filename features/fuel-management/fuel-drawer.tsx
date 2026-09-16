'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ArrowLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A right-hand sheet for drilling into one record or one vehicle without leaving the view underneath.
 * Radix Dialog underneath: focus is trapped while it is open, Escape closes it, focus returns to the row
 * that opened it. It slides in from an already-visible edge; with reduced motion it simply appears.
 */
export function FuelDrawer({
  open,
  onOpenChange,
  title,
  description,
  onBack,
  backLabel,
  headerExtra,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  onBack?: () => void
  backLabel?: string
  headerExtra?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fm-overlay fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs transition-opacity duration-200"
        />
        <DialogPrimitive.Content
          // The shell restores focus to what opened the first drawer; a drawer that opened another has left the DOM.
          onCloseAutoFocus={(event) => event.preventDefault()}
          className={cn(
            'fm fm-sheet fixed inset-y-0 right-0 z-50 flex w-full max-w-[44rem] flex-col border-l border-slate-200/80 bg-white shadow-[-16px_0_40px_-12px_rgba(15,23,42,0.22)] outline-none transition-all duration-300',
          )}
        >
          <header className="flex items-start gap-3.5 border-b border-slate-200/80 bg-slate-50/50 px-6 py-4.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900"
                aria-label={backLabel ?? 'Back'}
                title={backLabel ?? 'Back'}
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[17px] font-bold tracking-[-0.01em] text-slate-900 [text-wrap:balance]">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-slate-500">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>
              )}
              {headerExtra && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{headerExtra}</div>}
            </div>
            <DialogPrimitive.Close
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-900"
              aria-label="Close"
            >
              <X className="size-4.5" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="fm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200/80 bg-slate-50/50 px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function DrawerSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 py-4.5 first:border-t-0 first:pt-0">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}
