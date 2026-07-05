'use client'

/**
 * KPI business widgets. Each card communicates a pipeline stage's count,
 * supports click-to-filter, animates its counter, lifts on hover, and shows
 * an unmistakable active state when it is driving the current filter.
 */

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedNumber, Lift, motion, Stagger, StaggerItem } from './motion'
import { toneAccentVar, type Tone } from './primitives'

export type KpiDatum = {
  key: string
  label: string
  value: number
  icon: LucideIcon
  tone?: Tone
  hint?: string
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'accent',
  active = false,
  onClick,
  hint,
  format,
}: {
  label: string
  value: number
  icon: LucideIcon
  tone?: Tone
  active?: boolean
  onClick?: () => void
  hint?: string
  format?: (value: number) => string
}) {
  const accent = toneAccentVar(tone)
  const interactive = Boolean(onClick)
  return (
    <Lift disabled={!interactive} className="h-full">
      <button
        type="button"
        onClick={onClick}
        disabled={!interactive}
        aria-pressed={active}
        className={cn(
          'group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[1.35rem] border p-3.5 text-left transition-colors sm:p-4',
          interactive ? 'cursor-pointer' : 'cursor-default',
        )}
        style={{
          backgroundColor: active ? `color-mix(in srgb, ${accent} 10%, var(--kia-surface))` : 'var(--kia-surface)',
          borderColor: active ? `color-mix(in srgb, ${accent} 55%, transparent)` : 'var(--kia-hairline)',
          boxShadow: active ? `0 0 0 1px ${accent}, var(--kia-elev-3)` : 'var(--kia-elev-1)',
        }}
      >
        {/* accent wash that intensifies on hover / active */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            opacity: active ? 1 : undefined,
            background: `radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, ${accent} 12%, transparent), transparent 60%)`,
          }}
        />
        <div className="relative flex items-start justify-between gap-2">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl border transition-transform duration-300 group-hover:scale-105"
            style={{
              backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)`,
              borderColor: `color-mix(in srgb, ${accent} 26%, transparent)`,
              color: accent,
            }}
          >
            <Icon className="h-[1.05rem] w-[1.05rem]" />
          </span>
          {active && (
            <motion.span
              layoutId="kpi-active-dot"
              className="mt-1 h-2 w-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
          )}
        </div>
        <div className="relative mt-3">
          <p className="text-2xl font-extrabold leading-none tracking-tight text-[var(--kia-text)] sm:text-[1.7rem]">
            <AnimatedNumber value={value} format={format} />
          </p>
          <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--kia-text-soft)]">{label}</p>
          {hint && <p className="mt-0.5 text-[10px] font-medium text-[var(--kia-text-faint)]">{hint}</p>}
        </div>
      </button>
    </Lift>
  )
}

export function KpiRow({
  items,
  activeKey,
  onSelect,
  className,
}: {
  items: (KpiDatum & { active?: boolean })[]
  activeKey?: string | null
  onSelect?: (key: string) => void
  className?: string
}) {
  return (
    <Stagger className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7', className)}>
      {items.map((item) => (
        <StaggerItem key={item.key} className="h-full">
          <KpiCard
            label={item.label}
            value={item.value}
            icon={item.icon}
            tone={item.tone}
            hint={item.hint}
            active={item.active ?? activeKey === item.key}
            onClick={onSelect ? () => onSelect(item.key) : undefined}
          />
        </StaggerItem>
      ))}
    </Stagger>
  )
}
