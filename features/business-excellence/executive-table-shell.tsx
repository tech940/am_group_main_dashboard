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
        'min-w-0 overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white shadow-sm transition-all',
        isExpanded && 'ring-2 ring-slate-900/20 shadow-md',
        className
      )}
    >
      <div className={cn('flex items-center justify-between gap-3 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 px-4 py-3 text-white shadow-inner', headerClassName)}>
        <div className={cn('flex min-w-0 flex-1 items-center justify-between gap-3', headerContentClassName)}>
          <div className="min-w-0">
            <h3 className={cn('flex min-w-0 items-center gap-2 text-sm font-black tracking-tight', titleClassName)}>
              {icon ? <span className="flex shrink-0 items-center text-slate-300">{icon}</span> : null}
              <span className="truncate">{title}</span>
            </h3>
            {subtitle ? (
              <p className={cn('mt-0.5 truncate text-[10px] font-bold uppercase tracking-widest text-slate-400', subtitleClassName)}>
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
          className="h-7 w-7 shrink-0 rounded-lg border border-slate-700/60 bg-slate-800/80 p-0 text-slate-300 shadow-sm hover:bg-slate-700 hover:text-white focus-visible:ring-slate-400"
        >
          <ToggleIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {children}
    </section>
  )
}
