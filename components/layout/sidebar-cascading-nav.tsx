'use client'

/**
 * Pixel-Matched Premium SaaS Sidebar Navigation
 * Matches exact UI mockup provided by user:
 * - Soft gradient background with floating white cards
 * - Rich pastel icon badges per module
 * - Blue-indigo active gradient card
 * - Pill badges for brand tags (AM KIA, AM HYUNDAI, COMMON)
 * - Chevron & Star actions
 */

import Link from 'next/link'
import {
  ChevronDown,
  Bookmark,
  LayoutGrid,
  Building2,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'

export type NavNode = {
  key: string
  label: string
  href?: string
  icon?: LucideIcon
  logo?: string
  logoClassName?: string
  logoContainerClassName?: string
  active?: boolean
  disabled?: boolean
  badge?: string
  external?: boolean
  favourite?: { active: boolean; onToggle: () => void }
  children?: NavNode[]
}

export type NavGroup = { key: string; label?: string; nodes: NavNode[] }

export function CascadingNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[]
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <AccordionNav
      groups={groups}
      collapsed={collapsed}
      onNavigate={() => onNavigate?.()}
    />
  )
}

// ─── Section Label ───────────────────────────────────────────────────────────
function GroupLabel({ label }: { label: string }) {
  const upper = label.toUpperCase()
  const isFav = upper.includes('FAVOURITE')
  const isBranch = upper.includes('BRANCH')

  return (
    <div className="flex items-center gap-2 px-1 pb-2 pt-4 first:pt-0">
      {isFav ? (
        <Bookmark className="h-3.5 w-3.5 fill-[#055B65] text-[#055B65] shrink-0" />
      ) : isBranch ? (
        <Building2 className="h-3.5 w-3.5 text-teal-500 shrink-0" />
      ) : (
        <LayoutGrid className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
      )}
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500/90 select-none">
        {label}
      </p>
    </div>
  )
}

// ─── Module Icon Badge Colors ────────────────────────────────────────────────
function getIconBadgeStyle(label: string, active?: boolean) {
  if (active) return 'bg-white/20 text-white'

  const l = label.toLowerCase()
  if (l.includes('booking') || l.includes('dashboard')) return 'bg-blue-100 text-blue-600'
  if (l.includes('discount') || l.includes('approval')) return 'bg-emerald-100 text-emerald-600'
  if (l.includes('cockpit'))                             return 'bg-blue-100 text-blue-600'
  if (l.includes('delegation') || l.includes('task'))   return 'bg-emerald-100 text-emerald-600'
  if (l.includes('purchase') || l.includes('order'))    return 'bg-sky-100 text-sky-600'
  if (l.includes('petty') || l.includes('cash'))        return 'bg-purple-100 text-purple-600'
  if (l.includes('vendor payment'))                     return 'bg-teal-100 text-teal-600'
  if (l.includes('vendor registry'))                    return 'bg-teal-100 text-teal-600'
  if (l.includes('renewal') || l.includes('pipeline')) return 'bg-rose-100 text-rose-500'
  if (l.includes('call') || l.includes('analysis'))     return 'bg-indigo-100 text-indigo-600'
  if (l.includes('data') || l.includes('health'))       return 'bg-emerald-100 text-emerald-600'
  if (l.includes('admin'))                              return 'bg-teal-100 text-teal-600'
  if (l.includes('effective') || l.includes('access')) return 'bg-blue-100 text-blue-600'
  if (l.includes('scrap'))                              return 'bg-amber-100 text-amber-600'
  if (l.includes('insurance'))                          return 'bg-teal-100 text-teal-600'
  if (l.includes('finance'))                            return 'bg-violet-100 text-violet-600'
  return 'bg-slate-100 text-slate-600'
}

// ─── Pill Badge Styles ────────────────────────────────────────────────────────
function getBadgeStyle(badge?: string): React.CSSProperties {
  if (!badge) return {}
  const b = badge.toUpperCase()
  if (b.includes('KIA')) {
    return {
      background: 'linear-gradient(135deg, #EEF4FF, #D9E7FF)',
      color: '#2563EB',
    }
  }
  if (b.includes('HYUNDAI')) {
    return {
      background: 'linear-gradient(135deg, #E8FFF3, #D1FAE5)',
      color: '#15803D',
    }
  }
  if (b.includes('COMMON')) {
    return {
      background: 'linear-gradient(135deg, #F5EDFF, #E9D5FF)',
      color: '#7C3AED',
    }
  }
  return { background: '#F1F5F9', color: '#475569' }
}

// ─── Favourite Bookmark Button ────────────────────────────────────────────────
function FavBookmark({
  favourite,
  label,
  activeItem,
}: {
  favourite: { active: boolean; onToggle: () => void }
  label: string
  activeItem?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        favourite.onToggle()
      }}
      // before:-inset-2.5 grows the 24px star to a 44px hit target without growing the visual.
      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-transform hover:scale-110 cursor-pointer ml-auto before:absolute before:-inset-2.5 before:content-['']"
      aria-label={favourite.active ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      title={favourite.active ? 'Remove from favourites' : 'Add to favourites'}
    >
      <Bookmark
        className={cn(
          'h-3.5 w-3.5 transition-colors',
          favourite.active
            ? 'fill-[#055B65] text-[#055B65]'
            : activeItem
            ? 'text-white/60 hover:text-white'
            : 'text-slate-300 hover:text-[#055B65]'
        )}
      />
    </button>
  )
}

// ─── Accordion Container ──────────────────────────────────────────────────────
function AccordionNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[]
  collapsed: boolean
  onNavigate: () => void
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.key}>
          {!collapsed && group.label && <GroupLabel label={group.label} />}
          <div className="flex flex-col gap-2">
            {group.nodes.map((node) => (
              <AccordionRow
                key={node.key}
                node={node}
                depth={0}
                pathKey={node.key}
                open={open}
                onToggle={toggle}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Single Floating Card Row ─────────────────────────────────────────────────
function AccordionRow({
  node,
  depth,
  pathKey,
  open,
  onToggle,
  onNavigate,
}: {
  node: NavNode
  depth: number
  pathKey: string
  open: Set<string>
  onToggle: (key: string) => void
  onNavigate: () => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const expanded = open.has(pathKey)
  const Icon = node.icon
  const iconBadgeClass = getIconBadgeStyle(node.label, node.active)

  // min-h-11: every row is a ≥44px touch target (submenu rows without icon badges used to
  // bottom out around 31px).
  const rowClass = cn(
    'group flex w-full min-h-11 items-center gap-2.5 rounded-xl p-2 text-[11px] font-bold transition-all duration-200 select-none cursor-pointer',
    node.active
      ? 'sidebar-active-card text-white shadow-md'
      : 'bg-white text-slate-800 border border-slate-200/70 shadow-xs hover:border-slate-300 hover:shadow-sm hover:translate-y-[-1px]',
    node.disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
  )

  const activeStyle: React.CSSProperties = node.active
    ? {
        background: 'linear-gradient(135deg, var(--dashboard-action-bg) 0%, var(--dashboard-action-hover) 100%)',
        color: '#FFFFFF',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)',
      }
    : {}

  const expandChevron = hasChildren ? (
    <ChevronDown
      className={cn(
        'h-4 w-4 shrink-0 transition-transform duration-200 ml-auto',
        node.active ? 'text-white/80' : 'text-slate-400',
        expanded && 'rotate-180'
      )}
    />
  ) : null

  const inner = (
    <>
      {/* Icon Badge */}
      {(node.logo || Icon) && (
        <span
          className={cn(
            'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105',
            iconBadgeClass,
            node.logoContainerClassName
          )}
        >
          {node.logo ? (
            <img
              src={node.logo}
              alt={node.label}
              className={cn('h-full w-full object-contain p-1', node.logoClassName)}
            />
          ) : Icon ? (
            <Icon className="h-3.5 w-3.5" />
          ) : null}
        </span>
      )}

      {/* Label */}
      <span className="flex-1 truncate text-left leading-tight">{node.label}</span>

      {/* Brand Badge */}
      {node.badge && !node.active && (
        <span
          className="shrink-0 rounded-full border px-2.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider"
          style={getBadgeStyle(node.badge)}
        >
          {node.badge}
        </span>
      )}

      {/* Bookmark in place of arrow */}
      {node.favourite ? (
        <FavBookmark favourite={node.favourite} label={node.label} activeItem={node.active} />
      ) : (
        expandChevron
      )}
    </>
  )

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 8 }}>
      {node.href && !node.disabled ? (
        <div className="flex items-center w-full">
          <Link
            href={node.href}
            target={node.external ? '_blank' : undefined}
            rel={node.external ? 'noreferrer' : undefined}
            prefetch={false}
            onClick={onNavigate}
            className={cn(rowClass, 'w-full')}
            style={activeStyle}
            aria-current={node.active ? 'page' : undefined}
          >
            {inner}
          </Link>
        </div>
      ) : (
        <div className="flex items-center w-full">
          <button
            type="button"
            disabled={node.disabled}
            onClick={() => {
              if (hasChildren) onToggle(pathKey)
            }}
            className={cn(rowClass, 'w-full')}
            style={activeStyle}
            aria-expanded={hasChildren ? expanded : undefined}
          >
            {inner}
          </button>
        </div>
      )}

      {/* Expanded Sub-items */}
      {expanded && hasChildren && (
        <div className="mt-2 flex flex-col gap-2 border-l-2 border-indigo-100 pl-3 ml-4">
          {node.children!.map((child) => (
            <AccordionRow
              key={child.key}
              node={child}
              depth={depth + 1}
              pathKey={`${pathKey}/${child.key}`}
              open={open}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
