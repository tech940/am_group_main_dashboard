'use client'

/**
 * Structural primitives for the KIA premium design system.
 * Surfaces, chips, icon tiles and section shells that express hierarchy
 * through elevation + typography rather than colour. All tones derive from
 * the `--dashboard-*` tokens so they inherit every accent theme + dark mode.
 */

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Tone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  // Fixed vibrant hues for a colourful, multi-tone dashboard (theme-independent).
  | 'blue'
  | 'violet'
  | 'teal'
  | 'rose'
  | 'emerald'
  | 'sky'
  | 'amber'
  | 'indigo'

const TONE_BASE: Record<Tone, string> = {
  neutral: '#64748b',
  accent: 'var(--dashboard-action-bg)',
  success: 'var(--dashboard-success)',
  warning: 'var(--dashboard-warning)',
  danger: 'var(--dashboard-danger)',
  info: 'var(--dashboard-support-1)',
  blue: '#3b82f6',
  violet: '#8b5cf6',
  teal: '#14b8a6',
  rose: '#f43f5e',
  emerald: '#10b981',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  indigo: '#6366f1',
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'var(--kia-text-soft, #475569)',
  accent: 'var(--dashboard-action-bg)',
  success: 'var(--dashboard-success-text)',
  warning: 'var(--dashboard-warning-text)',
  danger: 'var(--dashboard-risk-text)',
  info: 'var(--dashboard-support-1)',
  blue: '#1d4ed8',
  violet: '#6d28d9',
  teal: '#0f766e',
  rose: '#be123c',
  emerald: '#047857',
  sky: '#0369a1',
  amber: '#b45309',
  indigo: '#4338ca',
}

export function toneSoftStyle(tone: Tone): React.CSSProperties {
  const base = TONE_BASE[tone]
  return {
    backgroundColor: `color-mix(in srgb, ${base} 13%, transparent)`,
    borderColor: `color-mix(in srgb, ${base} 28%, transparent)`,
    color: TONE_TEXT[tone],
  }
}

export function toneAccentVar(tone: Tone) {
  return TONE_BASE[tone]
}

/* -------------------------------------------------------------- Kicker */

export function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('kia-kicker', className)}>{children}</p>
}

/* ------------------------------------------------------------- IconTile */

export function IconTile({
  icon: Icon,
  tone = 'accent',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dims = size === 'lg' ? 'h-12 w-12 rounded-2xl' : size === 'sm' ? 'h-8 w-8 rounded-xl' : 'h-10 w-10 rounded-2xl'
  const iconDims = size === 'lg' ? 'h-[1.375rem] w-[1.375rem]' : size === 'sm' ? 'h-4 w-4' : 'h-[1.15rem] w-[1.15rem]'
  return (
    <span
      className={cn('grid shrink-0 place-items-center border', dims, className)}
      style={toneSoftStyle(tone)}
    >
      <Icon className={iconDims} />
    </span>
  )
}

/* ---------------------------------------------------------------- Chip */

export function Chip({
  children,
  tone = 'neutral',
  className,
  dot = false,
  icon: Icon,
}: {
  children: React.ReactNode
  tone?: Tone
  className?: string
  dot?: boolean
  icon?: LucideIcon
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]',
        className,
      )}
      style={toneSoftStyle(tone)}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: toneAccentVar(tone) }}
        />
      )}
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------- Section */

/**
 * A titled premium surface with an optional icon, kicker, description and
 * trailing action slot. This is the workhorse container for the module.
 */
export function Section({
  title,
  kicker,
  description,
  icon,
  iconTone = 'accent',
  actions,
  children,
  className,
  bodyClassName,
  tone,
}: {
  title?: React.ReactNode
  kicker?: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  iconTone?: Tone
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClassName?: string
  tone?: Tone
}) {
  const accent = tone ? toneAccentVar(tone) : undefined
  return (
    <section
      className={cn('kia-surface overflow-hidden', className)}
      style={accent ? { boxShadow: `inset 3px 0 0 ${accent}, var(--kia-elev-2)` } : undefined}
    >
      {(title || kicker || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <IconTile icon={icon} tone={iconTone} />}
            <div className="min-w-0">
              {kicker && <Kicker>{kicker}</Kicker>}
              {title && <h3 className="mt-0.5 truncate text-[15px] font-extrabold tracking-tight text-[var(--kia-text)] sm:text-base">{title}</h3>}
              {description && <p className="mt-0.5 text-xs font-medium leading-5 text-[var(--kia-text-soft)]">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('px-4 pb-4 pt-4 sm:px-5 sm:pb-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/* ----------------------------------------------------------- FieldValue */

/** Label + value pair used inside info grids. */
export function FieldValue({
  label,
  value,
  mono,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn('kia-surface-sunken px-3 py-2.5', className)}>
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">{label}</p>
      <p className={cn('mt-1 break-words text-[13px] font-bold leading-5 text-[var(--kia-text)]', mono && 'font-mono text-xs tracking-tight')}>
        {value || '—'}
      </p>
    </div>
  )
}
