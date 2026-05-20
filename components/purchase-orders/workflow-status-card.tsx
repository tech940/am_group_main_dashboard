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
  border: string
  accentDot: string
  statusBg: string
  metricBg: string
  footerText: string
}> = {
  sky: {
    surface: 'bg-white',
    border: 'border-sky-200',
    accentDot: 'bg-sky-500',
    statusBg: 'bg-sky-50 border-sky-200 text-sky-700',
    metricBg: 'bg-sky-50/50 border-sky-100',
    footerText: 'text-sky-600',
  },
  amber: {
    surface: 'bg-white',
    border: 'border-amber-200',
    accentDot: 'bg-amber-500',
    statusBg: 'bg-amber-50 border-amber-200 text-amber-700',
    metricBg: 'bg-amber-50/50 border-amber-100',
    footerText: 'text-amber-600',
  },
  violet: {
    surface: 'bg-white',
    border: 'border-violet-200',
    accentDot: 'bg-violet-500',
    statusBg: 'bg-violet-50 border-violet-200 text-violet-700',
    metricBg: 'bg-violet-50/50 border-violet-100',
    footerText: 'text-violet-600',
  },
  indigo: {
    surface: 'bg-white',
    border: 'border-indigo-200',
    accentDot: 'bg-indigo-500',
    statusBg: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    metricBg: 'bg-indigo-50/50 border-indigo-100',
    footerText: 'text-indigo-600',
  },
  teal: {
    surface: 'bg-white',
    border: 'border-teal-200',
    accentDot: 'bg-teal-500',
    statusBg: 'bg-teal-50 border-teal-200 text-teal-700',
    metricBg: 'bg-teal-50/50 border-teal-100',
    footerText: 'text-teal-600',
  },
  emerald: {
    surface: 'bg-white',
    border: 'border-emerald-200',
    accentDot: 'bg-emerald-500',
    statusBg: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    metricBg: 'bg-emerald-50/50 border-emerald-100',
    footerText: 'text-emerald-600',
  },
  rose: {
    surface: 'bg-white',
    border: 'border-rose-200',
    accentDot: 'bg-rose-500',
    statusBg: 'bg-rose-50 border-rose-200 text-rose-700',
    metricBg: 'bg-rose-50/50 border-rose-100',
    footerText: 'text-rose-600',
  },
  slate: {
    surface: 'bg-white',
    border: 'border-slate-200',
    accentDot: 'bg-slate-500',
    statusBg: 'bg-slate-50 border-slate-200 text-slate-700',
    metricBg: 'bg-slate-50/50 border-slate-100',
    footerText: 'text-slate-600',
  },
}

function MetricIcon({ icon }: { icon?: CardMetric['icon'] }) {
  switch (icon) {
    case 'quantity':
      return <Package2 className="h-3.5 w-3.5 text-slate-500" />
    case 'requester':
      return <User2 className="h-3.5 w-3.5 text-slate-500" />
    case 'assignee':
      return <Users2 className="h-3.5 w-3.5 text-slate-500" />
    case 'time':
      return <Clock3 className="h-3.5 w-3.5 text-slate-500" />
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
        'group relative overflow-hidden rounded-2xl border-2 p-5 shadow-sm transition-all duration-200',
        styles.surface,
        styles.border,
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
        className
      )}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider',
            styles.statusBg
          )}>
            <span className={cn('h-2 w-2 rounded-full', styles.accentDot)} />
            {statusLabel}
          </div>
          <div
            className="flex flex-shrink-0 items-center gap-2"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {timestampLabel && (
              <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {timestampLabel}
              </span>
            )}
            {headerAction}
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xl font-black tracking-tight text-slate-900">
            {orderNumber}
          </h3>
          <p className="line-clamp-2 text-sm text-slate-600">
            {description}
          </p>
        </div>

        <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
          {departmentLine}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {metrics.slice(0, 4).map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className={cn('rounded-xl border px-3 py-2.5', styles.metricBg)}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <MetricIcon icon={metric.icon} />
                {metric.label}
              </div>
              <p className="mt-1 line-clamp-1 text-sm font-bold text-slate-900">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 pt-3">
          <p className={cn('text-[11px] font-bold uppercase tracking-wider', styles.footerText)}>
            Stage: {stageLabel}
          </p>
        </div>

        {actions && (
          <div
            className="border-t border-slate-200 pt-4"
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
    <div className="relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
      <div className="animate-pulse space-y-4">
        <div className="h-7 w-36 rounded-lg bg-slate-100" />
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-slate-200" />
          <div className="h-4 w-52 rounded bg-slate-100" />
        </div>
        <div className="h-4 w-56 rounded bg-slate-100" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-16 rounded-xl bg-slate-100" />
          <div className="h-16 rounded-xl bg-slate-100" />
          <div className="h-16 rounded-xl bg-slate-100" />
          <div className="h-16 rounded-xl bg-slate-100" />
        </div>
        <div className="h-4 w-40 rounded bg-slate-100" />
      </div>
    </div>
  )
}
