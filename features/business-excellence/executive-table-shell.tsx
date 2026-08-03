'use client'

import type { ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ExecutiveDashboardTableId =
  | 'overall-load'
  | 'service-type-performance'
  | 'labour-revenue'
  | 'parts-revenue'
  | 'fy-trends'

type ExecutiveTableShellProps = {
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  isExpanded: boolean
  onToggleExpanded: () => void
  className?: string
  headerClassName?: string
  headerContentClassName?: string
  titleClassName?: string
  subtitleClassName?: string
  children: ReactNode
}

export function ExecutiveTableShell({
  title,
  subtitle,
  icon,
  actions,
  isExpanded,
  onToggleExpanded,
  className,
  headerClassName,
  headerContentClassName,
  titleClassName,
  subtitleClassName,
  children,
}: ExecutiveTableShellProps) {
  const ToggleIcon = isExpanded ? Minimize2 : Maximize2
  const label = `${isExpanded ? 'Minimize' : 'Maximize'} ${title}`

  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_12px_28px_-6px_rgba(15,23,42,0.08),0_4px_12px_-2px_rgba(15,23,42,0.03)] transition-all hover:shadow-[0_18px_38px_-8px_rgba(15,23,42,0.12)]',
        isExpanded && 'ring-2 ring-[#055B65]/30 shadow-xl',
        className
      )}
    >
      <div className={cn('flex items-center justify-between gap-3 bg-gradient-to-r from-slate-900 via-[#055B65] to-slate-900 px-5 py-3.5 text-white shadow-inner', headerClassName)}>
        <div className={cn('flex min-w-0 flex-1 items-center justify-between gap-3', headerContentClassName)}>
          <div className="min-w-0">
            <h3 className={cn('flex min-w-0 items-center gap-2 text-sm font-black tracking-tight text-white', titleClassName)}>
              {icon ? <span className="flex shrink-0 items-center text-teal-300">{icon}</span> : null}
              <span className="truncate">{title}</span>
            </h3>
            {subtitle ? (
              <p className={cn('mt-0.5 truncate text-[10px] font-bold uppercase tracking-widest text-teal-100/70', subtitleClassName)}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={isExpanded}
          title={label}
          onClick={onToggleExpanded}
          className="h-7 w-7 shrink-0 rounded-xl border border-white/20 bg-white/10 p-0 text-white shadow-xs hover:bg-white/20 hover:text-white"
        >
          <ToggleIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {children}
    </section>
  )
}
