'use client'

import { motion } from 'motion/react'
import { FileText, Calculator } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ApprovalCategory = 'purchase_orders' | 'ca'

type TabDef = {
  key: ApprovalCategory
  label: string
  shortLabel: string
  icon: typeof FileText
  count: number | null
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <motion.span
      key={count}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 24 }}
      className={cn(
        'ml-1 inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-black tabular-nums transition-colors',
        active
          ? 'bg-white/25 text-white'
          : count > 0
            ? 'bg-[var(--dashboard-action-bg)]/10 text-[var(--dashboard-action-bg)]'
            : 'bg-slate-200 text-slate-500',
      )}
    >
      {count}
    </motion.span>
  )
}

export function ApprovalCategoryTabs({
  active,
  onChange,
  purchaseOrderCount,
}: {
  active: ApprovalCategory
  onChange: (category: ApprovalCategory) => void
  purchaseOrderCount: number
}) {
  const tabs: TabDef[] = [
    { key: 'purchase_orders', label: 'Purchase Orders', shortLabel: 'Orders', icon: FileText, count: purchaseOrderCount },
    { key: 'ca', label: 'CA', shortLabel: 'CA', icon: Calculator, count: null },
  ]

  return (
    <div className="inline-flex w-full max-w-md items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1 shadow-sm">
      {tabs.map((tab) => {
        const isActive = tab.key === active
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors',
              isActive ? 'text-white' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="approval-tab-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-xl bg-[var(--dashboard-action-bg)] shadow-sm"
              />
            )}
            <span className="relative z-10 flex items-center">
              <Icon className="mr-2 h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
              {tab.count !== null && <CountBadge count={tab.count} active={isActive} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
