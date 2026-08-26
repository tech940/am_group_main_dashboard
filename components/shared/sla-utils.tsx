'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react'

// ── Severity Levels ──────────────────────────────────────────────────
export type SlaSeverityLevel = 'critical' | 'warning' | 'normal' | 'complete' | 'within_sla'

export type SlaCompliance = 'action_required' | 'complete' | 'not_required'

export interface SlaInfo {
  compliance: SlaCompliance
  remarkCount: number
  ageDays: number
  label: string
}

// ── Severity Determination ───────────────────────────────────────────
export function getWarrantySlaSeverity(compliance: SlaCompliance, remarkCount: number): SlaSeverityLevel {
  if (compliance === 'action_required' && remarkCount === 0) return 'critical'
  if (compliance === 'action_required') return 'warning'
  if (compliance === 'complete') return 'complete'
  return 'within_sla'
}

export function getAgingSeverity(agingDays: number): SlaSeverityLevel {
  if (agingDays > 15) return 'critical'
  if (agingDays > 7) return 'warning'
  if (agingDays > 4) return 'normal'
  return 'within_sla'
}

export function getOpenDaysSeverity(openDays: number): SlaSeverityLevel {
  if (openDays > 30) return 'critical'
  if (openDays > 15) return 'warning'
  if (openDays > 7) return 'normal'
  return 'within_sla'
}

// ── Row Sort Comparator ──────────────────────────────────────────────
const SEVERITY_ORDER: Record<SlaSeverityLevel, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
  complete: 3,
  within_sla: 4,
}

export function bySlaSeverity(a: SlaSeverityLevel, b: SlaSeverityLevel): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b]
}

// ── Row Highlight Classes ────────────────────────────────────────────
export function getSlaRowClass(severity: SlaSeverityLevel): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-50/70 border-l-4 border-l-rose-500'
    case 'warning':
      return 'bg-amber-50/40 border-l-4 border-l-amber-400'
    case 'complete':
      return 'border-l-4 border-l-emerald-400'
    case 'normal':
      return 'border-l-4 border-l-blue-300'
    case 'within_sla':
      return ''
  }
}

// ── Severity Config ──────────────────────────────────────────────────
interface SeverityConfig {
  bg: string
  text: string
  dot: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const SEVERITY_CONFIG: Record<SlaSeverityLevel, SeverityConfig> = {
  critical: {
    bg: 'bg-rose-100',
    text: 'text-rose-800',
    dot: 'bg-rose-500',
    label: 'Critical',
    icon: AlertTriangle,
  },
  warning: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    label: 'Warning',
    icon: AlertTriangle,
  },
  normal: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    dot: 'bg-blue-500',
    label: 'Normal',
    icon: Clock3,
  },
  complete: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    dot: 'bg-emerald-500',
    label: 'Completed',
    icon: CheckCircle2,
  },
  within_sla: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    label: 'Within SLA',
    icon: CheckCircle2,
  },
}

// ── Sla Severity Badge Component ─────────────────────────────────────
export function SlaSeverityBadge({
  severity,
  showIcon = true,
  size = 'sm',
}: {
  severity: SlaSeverityLevel
  showIcon?: boolean
  size?: 'sm' | 'md'
}) {
  const config = SEVERITY_CONFIG[severity]
  const Icon = config.icon
  const sizeClass = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-black uppercase tracking-wide',
        config.bg,
        config.text,
        sizeClass
      )}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {config.label}
    </span>
  )
}

// ── Sla Left Edge Indicator ──────────────────────────────────────────
export function SlaEdgeIndicator({ severity }: { severity: SlaSeverityLevel }) {
  if (severity === 'within_sla') return null
  const config = SEVERITY_CONFIG[severity]

  return (
    <div
      className={cn(
        'absolute left-0 top-0 h-full w-1',
        severity === 'critical' ? 'animate-pulse' : '',
        config.dot.replace('bg-', 'bg-')
      )}
    />
  )
}

// ── Severity Dot ─────────────────────────────────────────────────────
export function SlaSeverityDot({ severity, className }: { severity: SlaSeverityLevel; className?: string }) {
  const config = SEVERITY_CONFIG[severity]
  return <span className={cn('inline-block h-2 w-2 rounded-full', config.dot, className)} />
}

// ── Remarks Needed Count Badge ────────────────────────────────────────
export function RemarksNeededBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-rose-800 shadow-sm">
      <AlertTriangle className="h-3.5 w-3.5" />
      {count} Remar{count === 1 ? 'k' : 'ks'} Needed
    </span>
  )
}

// ── Aging Bucket to Severity Helper ─────────────────────────────────
export function agingBucketSeverity(bucket: string): SlaSeverityLevel {
  switch (bucket) {
    case '0-4D':
    case '0-4':
      return 'within_sla'
    case '5-7D':
    case '5-7':
      return 'normal'
    case '8-15D':
    case '8-15':
      return 'warning'
    case '>15D':
    case 'Over 15':
      return 'critical'
    default:
      return 'normal'
  }
}