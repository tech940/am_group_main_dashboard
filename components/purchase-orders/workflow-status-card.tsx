'use client'

import type { ReactNode } from 'react'
import { Clock3, Package2, User2, Users2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type CardTone = 'sky' | 'amber' | 'violet' | 'indigo' | 'teal' | 'emerald' | 'rose' | 'slate'

interface CardMetric {
  label: string
  value: string
  icon?: 'quantity' | 'requester' | 'assignee' | 'time'
}

interface WorkflowStatusCardProps {
  orderNumber: string
  statusLabel: string
  stageLabel: string
  description: string
  departmentLine: string
  metrics: CardMetric[]
  tone: CardTone
  timestampLabel?: string
  headerAction?: ReactNode
  actions?: ReactNode
  onClick?: () => void
  className?: string
}

const toneStyles: Record<CardTone, {
  surface: string
  accentDot: string
  accentGlow: string
  footerText: string
}> = {
  sky: {
    surface: 'from-sky-700 via-teal-700 to-emerald-700',
    accentDot: 'bg-sky-300',
    accentGlow: 'bg-sky-300/15',
    footerText: 'text-sky-100/70',
  },
  amber: {
    surface: 'from-emerald-700 via-teal-700 to-emerald-600',
    accentDot: 'bg-amber-300',
    accentGlow: 'bg-amber-300/15',
    footerText: 'text-amber-100/75',
  },
  violet: {
    surface: 'from-violet-800 via-teal-700 to-emerald-700',
    accentDot: 'bg-violet-300',
    accentGlow: 'bg-violet-300/15',
    footerText: 'text-violet-100/75',
  },
  indigo: {
    surface: 'from-indigo-800 via-teal-700 to-emerald-700',
    accentDot: 'bg-indigo-300',
    accentGlow: 'bg-indigo-300/15',
    footerText: 'text-indigo-100/75',
  },
  teal: {
    surface: 'from-teal-800 via-emerald-700 to-teal-600',
    accentDot: 'bg-teal-200',
    accentGlow: 'bg-teal-200/15',
    footerText: 'text-teal-100/75',
  },
  emerald: {
    surface: 'from-emerald-800 via-teal-700 to-emerald-600',
    accentDot: 'bg-emerald-200',
    accentGlow: 'bg-emerald-200/15',
    footerText: 'text-emerald-100/75',
  },
  rose: {
    surface: 'from-rose-800 via-emerald-700 to-teal-700',
    accentDot: 'bg-rose-300',
    accentGlow: 'bg-rose-300/15',
    footerText: 'text-rose-100/75',
  },
  slate: {
    surface: 'from-slate-800 via-teal-800 to-emerald-700',
    accentDot: 'bg-slate-200',
    accentGlow: 'bg-slate-200/15',
    footerText: 'text-slate-100/70',
  },
}

function MetricIcon({ icon }: { icon?: CardMetric['icon'] }) {
  switch (icon) {
    case 'quantity':
      return <Package2 className="h-3.5 w-3.5 text-white/70" />
    case 'requester':
      return <User2 className="h-3.5 w-3.5 text-white/70" />
    case 'assignee':
      return <Users2 className="h-3.5 w-3.5 text-white/70" />
    case 'time':
      return <Clock3 className="h-3.5 w-3.5 text-white/70" />
    default:
      return null
  }
}

export function WorkflowStatusCard({
  orderNumber,
  statusLabel,
  stageLabel,
  description,
  departmentLine,
  metrics,
  tone,
  timestampLabel,
  headerAction,
  actions,
  onClick,
  className,
}: WorkflowStatusCardProps) {
  const styles = toneStyles[tone]

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group relative overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-br p-5 text-white shadow-[0_24px_70px_rgba(5,46,37,0.28)] transition-all duration-300',
        styles.surface,
        onClick && 'cursor-pointer hover:-translate-y-1 hover:shadow-[0_32px_90px_rgba(5,46,37,0.38)]',
        className
      )}
    >
      <div className={cn('absolute -right-6 -top-6 h-24 w-24 rounded-full blur-[1px]', styles.accentGlow)} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_36%)]" />

      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/90 backdrop-blur-sm">
            <span className={cn('h-2 w-2 rounded-full', styles.accentDot)} />
            {statusLabel}
          </div>
          <div
            className="flex flex-shrink-0 items-center gap-2"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {timestampLabel && (
              <span className="text-right text-[10px] font-bold uppercase tracking-[0.16em] text-white/65">
                {timestampLabel}
              </span>
            )}
            {headerAction}
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-[1.35rem] font-black tracking-tight text-white">
            {orderNumber}
          </h3>
          <p className="line-clamp-2 text-sm text-white/82">
            {description}
          </p>
        </div>

        <div className="text-[12px] font-black uppercase tracking-[0.14em] text-white/96">
          {departmentLine}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {metrics.slice(0, 4).map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 backdrop-blur-[2px]"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62">
                <MetricIcon icon={metric.icon} />
                {metric.label}
              </div>
              <p className="mt-1 line-clamp-1 text-sm font-semibold text-white">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-white/14 pt-3">
          <p className={cn('text-[11px] font-black uppercase tracking-[0.18em]', styles.footerText)}>
            Stage: {stageLabel}
          </p>
        </div>

        {actions && (
          <div
            className="border-t border-white/14 pt-4"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export function WorkflowStatusCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-br from-slate-700 via-teal-800 to-emerald-700 p-5 shadow-[0_24px_70px_rgba(5,46,37,0.2)]">
      <div className="animate-pulse space-y-4">
        <div className="h-7 w-36 rounded-full bg-white/15" />
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-white/20" />
          <div className="h-4 w-52 rounded bg-white/12" />
        </div>
        <div className="h-4 w-56 rounded bg-white/15" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-16 rounded-2xl bg-white/10" />
          <div className="h-16 rounded-2xl bg-white/10" />
          <div className="h-16 rounded-2xl bg-white/10" />
          <div className="h-16 rounded-2xl bg-white/10" />
        </div>
        <div className="h-4 w-40 rounded bg-white/12" />
      </div>
    </div>
  )
}
