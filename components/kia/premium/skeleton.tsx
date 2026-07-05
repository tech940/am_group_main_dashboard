'use client'

/** Shimmer skeletons that match the premium surfaces. */

import * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('kia-skeleton', className)} style={style} />
}

export function TableSkeleton({ rows = 8, columns = 8 }: { rows?: number; columns?: number }) {
  return (
    <div className="kia-surface overflow-hidden">
      <div className="border-b border-[var(--kia-hairline)] px-4 py-3.5" style={{ background: 'var(--dashboard-primary)' }}>
        <Skeleton className="h-3.5 w-40" style={{ background: 'rgba(255,255,255,0.18)' }} />
      </div>
      <div className="divide-y divide-[var(--kia-hairline)]">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="grid items-center gap-3 px-4 py-3.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
            {Array.from({ length: columns }).map((__, c) => (
              <Skeleton key={c} className="h-4" style={{ width: c === 1 ? '85%' : c === columns - 1 ? '60%' : '70%' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function InspectorSkeleton() {
  return (
    <div className="kia-scroll space-y-4 p-4 sm:p-5" style={{ background: 'var(--kia-canvas)' }}>
      <Skeleton className="h-36 w-full rounded-[1.6rem]" />
      <Skeleton className="h-16 w-full rounded-[1.4rem]" />
      <Skeleton className="h-24 w-full rounded-[1.4rem]" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-[1.4rem]" />
        <Skeleton className="h-44 rounded-[1.4rem]" />
      </div>
      <Skeleton className="h-56 w-full rounded-[1.4rem]" />
    </div>
  )
}
