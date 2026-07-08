'use client'

/* eslint-disable react-hooks/set-state-in-effect */

/**
 * Accordion sidebar navigation — click-to-expand for all devices.
 *
 * All nav items expand inline when clicked; no hover flyouts are used.
 * This provides a consistent, accessible navigation experience on both
 * desktop and mobile.
 */

import Link from 'next/link'
import { ChevronDown, Star, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

// Always use accordion (click-to-expand) navigation for all devices.
// This provides consistent UX across desktop and mobile — no hover flyouts.
export function CascadingNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[]
  collapsed: boolean
  onNavigate?: () => void
}) {
  return <AccordionNav groups={groups} collapsed={collapsed} onNavigate={() => onNavigate?.()} />
}

function GroupLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-50/45">{label}</p>
  )
}



function FavStar({ favourite, label }: { favourite: { active: boolean; onToggle: () => void }; label: string }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); favourite.onToggle() }}
      className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border transition',
        favourite.active
          ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
          : 'border-white/10 bg-white/8 text-indigo-50/55 hover:bg-white/14 hover:text-amber-200',
      )}
      aria-label={favourite.active ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      title={favourite.active ? 'Remove from favourites' : 'Add to favourites'}
    >
      <Star className={cn('h-3.5 w-3.5', favourite.active && 'fill-current')} />
    </button>
  )
}


/* ------------------------------------------------------------------ */
/* Accordion: click-to-expand inline navigation for all devices.       */
/* ------------------------------------------------------------------ */

function AccordionNav({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed: boolean; onNavigate: () => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.key} className="space-y-1.5">
          {!collapsed && group.label && <GroupLabel label={group.label} />}
          {group.nodes.map((node) => (
            <AccordionRow key={node.key} node={node} depth={0} pathKey={node.key} open={open} onToggle={toggle} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </div>
  )
}

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
  const rowClass = cn(
    'flex items-center gap-2.5 rounded-xl border-l-4 px-3 py-2.5 text-[13px] transition-colors',
    node.active ? 'bg-white/22 border-white font-semibold text-white' : 'bg-white/10 border-transparent text-indigo-50/85 hover:bg-white/16 hover:text-white active:bg-white/20',
    node.disabled && 'opacity-60',
  )
  const label = (
    <>
      {(node.logo || Icon) && (
        <span className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/12', node.logoContainerClassName)}>
          {node.logo ? <img src={node.logo} alt={node.label} className={cn('h-full w-full object-contain', node.logoClassName)} /> : Icon ? <Icon className="h-4 w-4" /> : null}
        </span>
      )}
      <span className="flex-1 truncate text-left">{node.label}</span>
      {node.badge && <span className="text-[8px] font-black uppercase tracking-widest text-indigo-50/50">{node.badge}</span>}
      {hasChildren && <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-indigo-50/60 transition-transform', expanded && 'rotate-180')} />}
    </>
  )
  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 10 }}>
      {node.href && !hasChildren && !node.disabled ? (
        <div className="flex items-center gap-1">
          <Link
            href={node.href}
            target={node.external ? '_blank' : undefined}
            rel={node.external ? 'noreferrer' : undefined}
            prefetch={false}
            onClick={onNavigate}
            className={cn(rowClass, 'flex-1')}
          >
            {label}
          </Link>
          {node.favourite && <FavStar favourite={node.favourite} label={node.label} />}
        </div>
      ) : (
        <button
          type="button"
          disabled={node.disabled}
          onClick={() => { if (hasChildren) onToggle(pathKey) }}
          className={cn(rowClass, 'w-full')}
        >
          {label}
        </button>
      )}
      {expanded && hasChildren && (
        <div className="mt-1 space-y-1 border-l border-white/10 pl-1.5">
          {node.children!.map((child) => (
            <AccordionRow key={child.key} node={child} depth={depth + 1} pathKey={`${pathKey}/${child.key}`} open={open} onToggle={onToggle} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

