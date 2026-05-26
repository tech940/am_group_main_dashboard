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
  glow: string
  accentBar: string
  accentDot: string
  statusBg: string
  metricBg: string
  metricIcon: string
  footerText: string
  footerBg: string
}> = {
  sky: {
    surface: 'bg-[#cfeaff]',
    border: 'border-sky-300',
    glow: 'bg-sky-400/35',
    accentBar: 'from-sky-500 via-cyan-400 to-blue-300',
    accentDot: 'bg-sky-500',
    statusBg: 'bg-white/55 border-sky-300/80 text-sky-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-sky-600',
    footerText: 'text-sky-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  amber: {
    surface: 'bg-[#ffdca8]',
    border: 'border-orange-300',
    glow: 'bg-orange-400/35',
    accentBar: 'from-amber-500 via-orange-400 to-yellow-300',
    accentDot: 'bg-amber-500',
    statusBg: 'bg-white/55 border-orange-300/80 text-orange-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-amber-600',
    footerText: 'text-orange-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  violet: {
    surface: 'bg-[#ddc7ff]',
    border: 'border-violet-300',
    glow: 'bg-violet-400/35',
    accentBar: 'from-violet-500 via-indigo-400 to-sky-300',
    accentDot: 'bg-violet-500',
    statusBg: 'bg-white/55 border-violet-300/80 text-violet-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-violet-600',
    footerText: 'text-violet-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  indigo: {
    surface: 'bg-[#cdd8ff]',
    border: 'border-indigo-300',
    glow: 'bg-indigo-400/35',
    accentBar: 'from-indigo-500 via-blue-500 to-sky-300',
    accentDot: 'bg-indigo-500',
    statusBg: 'bg-white/55 border-indigo-300/80 text-indigo-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-indigo-600',
    footerText: 'text-indigo-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  teal: {
    surface: 'bg-[#bff1e3]',
    border: 'border-teal-300',
    glow: 'bg-teal-400/35',
    accentBar: 'from-teal-600 via-cyan-500 to-emerald-300',
    accentDot: 'bg-teal-500',
    statusBg: 'bg-white/55 border-teal-300/80 text-teal-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-teal-600',
    footerText: 'text-teal-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  emerald: {
    surface: 'bg-[#cbefc6]',
    border: 'border-emerald-300',
    glow: 'bg-emerald-400/35',
    accentBar: 'from-emerald-600 via-teal-500 to-lime-300',
    accentDot: 'bg-emerald-500',
    statusBg: 'bg-white/55 border-emerald-300/80 text-emerald-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-emerald-600',
    footerText: 'text-emerald-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  rose: {
    surface: 'bg-[#ffcbd8]',
    border: 'border-rose-300',
    glow: 'bg-rose-400/35',
    accentBar: 'from-rose-500 via-red-400 to-orange-300',
    accentDot: 'bg-rose-500',
    statusBg: 'bg-white/55 border-rose-300/80 text-rose-950',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-rose-600',
    footerText: 'text-rose-800',
    footerBg: 'bg-white/36 border-white/55',
  },
  slate: {
    surface: 'bg-[#dce3ea]',
    border: 'border-slate-300',
    glow: 'bg-slate-400/30',
    accentBar: 'from-slate-500 via-slate-400 to-slate-300',
    accentDot: 'bg-slate-500',
    statusBg: 'bg-white/55 border-slate-300/80 text-slate-900',
    metricBg: 'bg-white/34 border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]',
    metricIcon: 'text-slate-500',
    footerText: 'text-slate-600',
    footerBg: 'bg-white/36 border-white/55',
  },
}

function MetricIcon({ icon, className }: { icon?: CardMetric['icon']; className?: string }) {
  switch (icon) {
    case 'quantity':
      return <Package2 className={cn('h-3.5 w-3.5', className)} />
    case 'requester':
      return <User2 className={cn('h-3.5 w-3.5', className)} />
    case 'assignee':
      return <Users2 className={cn('h-3.5 w-3.5', className)} />
    case 'time':
      return <Clock3 className={cn('h-3.5 w-3.5', className)} />
    default:
      return null
  }
}

function getStageCode(statusLabel: string, stageLabel: string) {
  const combinedLabel = `${statusLabel} ${stageLabel}`.toLowerCase()

  if (combinedLabel.includes('ea')) return 'EA'
  if (combinedLabel.includes('md')) return 'MD'
  if (combinedLabel.includes('grn')) return 'GRN'
  if (combinedLabel.includes('account')) return 'ACC'
  if (combinedLabel.includes('vendor')) return 'VEN'
  if (combinedLabel.includes('hold')) return 'HLD'
  if (combinedLabel.includes('denied') || combinedLabel.includes('reject')) return 'NO'
  if (combinedLabel.includes('complete')) return 'OK'

  return 'PO'
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
  const stageCode = getStageCode(statusLabel, stageLabel)

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
        'group relative overflow-hidden rounded-[22px] border p-4 shadow-[0_16px_38px_rgba(15,23,42,0.10)] transition-all duration-300 sm:p-5',
        styles.surface,
        styles.border,
        onClick && 'cursor-pointer hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(15,23,42,0.14)]',
        className
      )}
    >
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r', styles.accentBar)} />
      <div className={cn('pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-45 blur-2xl transition-opacity duration-300 group-hover:opacity-65', styles.glow)} />

      <div className="relative flex min-h-[318px] flex-col space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className={cn(
            'inline-flex min-h-9 max-w-[72%] items-center gap-2 rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider shadow-sm',
            styles.statusBg
          )}>
            <span className={cn('h-2 w-2 shrink-0 rounded-full', styles.accentDot)} />
            <span className="line-clamp-2">{statusLabel}</span>
          </div>
          <div className="flex flex-shrink-0 items-start gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/65 text-[12px] font-black tracking-tight text-slate-900 shadow-sm ring-1 ring-white/70">
              {stageCode}
            </div>
            <div
              className="flex items-center gap-2"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {headerAction}
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          <span className="sr-only">Purchase order {orderNumber}</span>
          <p className="line-clamp-2 min-h-[45px] text-[19px] font-black leading-[1.16] tracking-tight text-slate-950">
            {description}
          </p>
          {timestampLabel && (
            <div className="inline-flex rounded-full bg-white/48 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-700 ring-1 ring-white/55">
              {timestampLabel}
            </div>
          )}
        </div>

        <div className="line-clamp-2 rounded-[14px] bg-white/36 px-3 py-2 text-[11px] font-black uppercase leading-4 tracking-wider text-slate-800 ring-1 ring-white/50">
          {departmentLine}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {metrics.slice(0, 4).map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className={cn('min-h-[58px] rounded-[14px] border px-3 py-2 transition-colors group-hover:bg-white/65', styles.metricBg)}
            >
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                <MetricIcon icon={metric.icon} className={styles.metricIcon} />
                {metric.label}
              </div>
              <p className="mt-1 line-clamp-1 text-sm font-bold text-slate-900">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className={cn('mt-auto rounded-[14px] border px-3 py-2', styles.footerBg)}>
          <p className={cn('text-[10px] font-black uppercase tracking-[0.14em]', styles.footerText)}>
            Stage: {stageLabel}
          </p>
        </div>

        {actions && (
          <div
            className="border-t border-slate-200/70 pt-4"
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
    <div className="relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200/70 p-4 shadow-sm sm:p-5">
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
