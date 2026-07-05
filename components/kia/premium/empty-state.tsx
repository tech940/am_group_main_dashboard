'use client'

/**
 * Premium empty states. No blank white boxes — each has a purposeful
 * automotive illustration, a clear message, and an optional suggested action.
 */

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, usePremiumMotion } from './motion'

type Illustration = 'garage' | 'search' | 'road' | 'error'

function GarageArt() {
  const animated = usePremiumMotion()
  return (
    <svg viewBox="0 0 160 110" className="h-full w-full" style={{ color: 'var(--dashboard-action-bg)' }}>
      {/* empty parking bay */}
      <rect x="20" y="24" width="120" height="66" rx="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 6" opacity="0.35" />
      <line x1="80" y1="30" x2="80" y2="84" stroke="currentColor" strokeWidth="2" strokeDasharray="4 6" opacity="0.22" />
      {/* ghost car */}
      <motion.g
        opacity="0.5"
        animate={animated ? { y: [0, -3, 0] } : undefined}
        transition={{ repeat: Infinity, ease: 'easeInOut', duration: 3 }}
      >
        <path
          d="M46 70 c0 -2 1.6 -3 4 -3.4 l3 0 c1.6 -6 6 -9 13 -9 l30 0 c7 0 12 3.4 16 9 l6 1 c3 0.6 5 2 5 5 l0 2 c0 1 -1 1.6 -2 1.6 l-80 0 c-2 0 -3 -1 -3 -3.4 Z"
          fill="color-mix(in srgb, currentColor 12%, transparent)"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="66" cy="76" r="6" fill="var(--kia-surface,#fff)" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="104" cy="76" r="6" fill="var(--kia-surface,#fff)" stroke="currentColor" strokeWidth="2.4" />
      </motion.g>
    </svg>
  )
}

function SearchArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-full w-full" style={{ color: 'var(--dashboard-action-bg)' }}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x="26" y={34 + i * 16} width="108" height="9" rx="4.5" fill="color-mix(in srgb, currentColor 12%, transparent)" />
      ))}
      <circle cx="104" cy="50" r="20" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.75" />
      <line x1="119" y1="65" x2="132" y2="78" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.75" />
    </svg>
  )
}

function RoadArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-full w-full" style={{ color: 'var(--dashboard-action-bg)' }}>
      <path d="M20 96 L66 24 L94 24 L140 96 Z" fill="color-mix(in srgb, currentColor 8%, transparent)" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <line x1="80" y1="34" x2="80" y2="90" stroke="currentColor" strokeWidth="3" strokeDasharray="8 8" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

function ErrorArt() {
  return (
    <svg viewBox="0 0 160 110" className="h-full w-full" style={{ color: 'var(--dashboard-danger)' }}>
      <path d="M80 22 L138 92 L22 92 Z" fill="color-mix(in srgb, currentColor 10%, transparent)" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <line x1="80" y1="46" x2="80" y2="72" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="80" cy="82" r="3" fill="currentColor" />
    </svg>
  )
}

const ART: Record<Illustration, React.ReactNode> = {
  garage: <GarageArt />,
  search: <SearchArt />,
  road: <RoadArt />,
  error: <ErrorArt />,
}

export function PremiumEmptyState({
  illustration = 'garage',
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: {
  illustration?: Illustration
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
}) {
  const animated = usePremiumMotion()
  return (
    <motion.div
      className={cn('kia-surface flex flex-col items-center justify-center px-6 py-12 text-center sm:py-16', className)}
      initial={animated ? { opacity: 0, y: 12 } : false}
      animate={animated ? { opacity: 1, y: 0 } : false}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="h-24 w-36 sm:h-28 sm:w-44">{ART[illustration]}</div>
      <div className="mt-5 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-[var(--dashboard-action-bg)]" />}
        <h3 className="text-lg font-extrabold tracking-tight text-[var(--kia-text)] sm:text-xl">{title}</h3>
      </div>
      {description && <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-[var(--kia-text-soft)]">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {action}
          {secondaryAction}
        </div>
      )}
    </motion.div>
  )
}
