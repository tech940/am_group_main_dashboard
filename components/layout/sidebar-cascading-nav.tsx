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
      {/*
        * Group headings take the same neutral grey as the module icons — see getIconBadgeStyle.
        * These were teal, indigo and a hardcoded #055B65; the hardcoded one also pinned the heading
        * to a single theme, so it stayed teal when the dashboard theme changed around it.
        *
        * Favourites keeps its FILLED bookmark. That is a shape difference, not a colour one, and it
        * still reads at a glance in monochrome — which is the point.
        */}
      {isFav ? (
        <Bookmark className="h-3.5 w-3.5 fill-slate-400 text-slate-400 shrink-0" />
      ) : isBranch ? (
        <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      ) : (
        <LayoutGrid className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      )}
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500/90 select-none">
        {label}
      </p>
    </div>
  )
}

/**
 * Module icon treatment — ONE neutral colour for every section.
 *
 * ── Why the colours went ──────────────────────────────────────────────────────────────────────
 * This used to map keywords in the label to seventeen different tints: blue for bookings, emerald
 * for approvals, purple for petty cash, rose for renewals, and so on. Three problems with that:
 *
 *   1. The colour meant NOTHING. It was assigned by substring, so "Vendor Payment" and "Insurance"
 *      came out the same teal for no shared reason, while "Purchase Order" (sky) and "Petty Cash"
 *      (purple) differed for no reason either. Colour that does not encode anything still costs the
 *      reader attention, and a sidebar is scanned, not studied.
 *   2. It fought the one colour that DOES mean something — the active item. When every row is
 *      already coloured, the selected row stops standing out.
 *   3. It was keyword-matched, so a section renamed tomorrow silently changes colour, and a new
 *      section falls through to grey — the palette drifted on its own.
 *
 * Now: slate for everything at rest, and the active pill keeps white-on-navy. The nav has exactly
 * one colour, and it marks where you are.
 *
 * ⚠️ `active` must stay first. Without it the active row would render slate-on-navy and become the
 * hardest row to read rather than the easiest.
 */
function getIconBadgeStyle(_label: string, active?: boolean) {
  if (active) return 'bg-white/20 text-white'
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
      {/*
        * Neutral like every other icon in the nav. The FILL is what says "favourited" — a solid
        * bookmark against an outlined one — so the state survives losing the teal, and it survives
        * for a colour-blind reader too, which it did not when hue was doing the work.
        */}
      <Bookmark
        className={cn(
          'h-3.5 w-3.5 transition-colors',
          favourite.active
            ? 'fill-slate-500 text-slate-500'
            : activeItem
            ? 'text-white/60 hover:text-white'
            : 'text-slate-300 hover:text-slate-500'
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
      <span className="flex-1 truncate text-left leading-tight flex items-center gap-1.5 min-w-0">
        <span className="truncate">{node.label}</span>
        {/*
          * The 360 chip is the ONE accent left in the nav, and it now comes from the THEME rather
          * than a literal.
          *
          * It was `bg-teal-50 text-[#055B65]` — a hardcoded tropical-teal that (a) clashed with the
          * sidebar's own lavender surface (#EEF4FF), which is why it read as wrong rather than as
          * special, and (b) stayed teal when the dashboard theme changed around it, because a hex
          * literal cannot follow a token.
          *
          * --dashboard-primary-soft / -primary / -primary-border is the app's existing chip triple.
          * On the default theme that is #f2f5ff on #4B49AC — the same family as the sidebar surface,
          * so it belongs to the nav instead of fighting it, and it re-tints with the theme.
          *
          * ⚠️ Inline style, not a Tailwind arbitrary value: `bg-[var(--x)]` has silently failed
          * elsewhere in this codebase, and a chip that renders transparent would be invisible.
          */}
        {(node.key === '/customer-360' || node.label.toLowerCase().includes('customer 360')) && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight shrink-0 shadow-2xs border transition-colors select-none",
              node.active && "bg-white/20 text-white border-white/30",
            )}
            style={node.active ? undefined : {
              background: 'var(--dashboard-primary-soft, #f2f5ff)',
              color: 'var(--dashboard-primary, #4B49AC)',
              borderColor: 'var(--dashboard-primary-border, #cbd8ff)',
            }}
            title="360° Customer Intelligence"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-2.5 w-2.5"
            >
              <path d="M21.5 12A9.5 9.5 0 1 1 15 3.3" />
              <polyline points="21.5 3 21.5 7.5 17 7.5" />
            </svg>
            <span>360°</span>
          </span>
        )}
      </span>

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
