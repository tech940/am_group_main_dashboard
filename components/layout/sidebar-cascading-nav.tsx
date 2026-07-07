'use client'

/* eslint-disable react-hooks/set-state-in-effect */

/**
 * Cascading, hover-driven sidebar navigation (desktop-app style).
 *
 * Top-level rows live in the sidebar rail. Hovering a row with children opens a
 * floating panel to its RIGHT (portaled to <body>, so it is never clipped by the
 * sidebar's overflow). Hovering a child that itself has children opens the next
 * panel further right — a true cascade, not nested/indented lists. A short
 * hover-intent delay keeps panels open while the cursor travels between them.
 */

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Star, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

type OpenEntry = { key: string; rect: DOMRect }

const CLOSE_DELAY = 180

export function CascadingNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[]
  collapsed: boolean
  onNavigate?: () => void
}) {
  const nodes = useMemo(() => groups.flatMap((group) => group.nodes), [groups])

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Touch / no-hover devices (phones, tablets) can't drive hover cascades and
  // have no room for right-side flyouts — they get an inline tap accordion.
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(hover: none), (pointer: coarse)')
    const apply = () => setIsTouch(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const [openPath, setOpenPath] = useState<OpenEntry[]>([])
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpenPath([]), CLOSE_DELAY)
  }, [cancelClose])
  const closeNow = useCallback(() => { cancelClose(); setOpenPath([]) }, [cancelClose])

  // Open the flyout chain up to `level`, replacing from that level with this node.
  const openAt = useCallback((level: number, key: string, el: HTMLElement | null) => {
    if (!el) return
    cancelClose()
    setOpenPath((prev) => [...prev.slice(0, level), { key, rect: el.getBoundingClientRect() }])
  }, [cancelClose])

  const resolve = useCallback((keys: string[]): NavNode | null => {
    let list = nodes
    let node: NavNode | null = null
    for (const key of keys) {
      node = list.find((candidate) => candidate.key === key) || null
      if (!node) return null
      list = node.children || []
    }
    return node
  }, [nodes])

  const navigate = useCallback(() => { closeNow(); onNavigate?.() }, [closeNow, onNavigate])

  // Close everything on scroll/resize — the anchored rects would otherwise drift.
  useEffect(() => {
    if (openPath.length === 0) return
    const handler = () => closeNow()
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [openPath.length, closeNow])

  if (isTouch) {
    return <AccordionNav groups={groups} collapsed={collapsed} onNavigate={() => onNavigate?.()} />
  }

  const panels = openPath.map((entry, level) => {
    const node = resolve(openPath.slice(0, level + 1).map((item) => item.key))
    if (!node?.children?.length) return null
    return (
      <FlyoutPanel key={node.key} rect={entry.rect} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
        {node.children.map((child) => (
          <FlyoutRow key={child.key} node={child} onOpen={(el) => openAt(level + 1, child.key, el)} onNavigate={navigate} />
        ))}
      </FlyoutPanel>
    )
  })

  return (
    <nav className="space-y-5" onMouseLeave={scheduleClose}>
      {groups.map((group) => (
        <div key={group.key} className="space-y-1.5">
          {!collapsed && group.label && <GroupLabel label={group.label} />}
          {group.nodes.map((node) => (
            <RailRow
              key={node.key}
              node={node}
              collapsed={collapsed}
              open={openPath[0]?.key === node.key}
              onOpen={(el) => openAt(0, node.key, el)}
              onNavigate={navigate}
            />
          ))}
        </div>
      ))}
      {mounted && createPortal(<>{panels}</>, document.body)}
    </nav>
  )
}

function GroupLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-50/45">{label}</p>
  )
}

function RailRow({
  node,
  collapsed,
  open,
  onOpen,
  onNavigate,
}: {
  node: NavNode
  collapsed: boolean
  open: boolean
  onOpen: (el: HTMLElement | null) => void
  onNavigate: () => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const Icon = node.icon

  const rowClass = cn(
    'group relative flex items-center gap-3 rounded-xl border-l-4 transition-all duration-200 outline-none w-full',
    open
      ? 'bg-white/22 border-white text-white font-semibold shadow-sm shadow-indigo-950/10 pl-3'
      : 'bg-white/10 border-transparent text-indigo-50/85 hover:bg-white/18 hover:text-white hover:border-white/70 pl-3',
    node.disabled && 'opacity-60 cursor-not-allowed',
    collapsed ? 'h-10 w-10 justify-center p-0 mx-auto border-l-0' : 'py-2.5 pr-3',
  )

  const inner = (
    <>
      {(node.logo || Icon) && (
        <span className={cn(
          'flex h-[1.875rem] w-[1.875rem] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-all',
          open ? 'bg-white/20' : 'bg-white/12 group-hover:bg-white/20',
          node.logoContainerClassName,
        )}>
          {node.logo ? (
            <img src={node.logo} alt={node.label} className={cn('h-full w-full object-contain', node.logoClassName)} />
          ) : Icon ? (
            <Icon className="h-4.5 w-4.5" />
          ) : null}
        </span>
      )}
      {!collapsed && <span className="flex-1 truncate text-left text-[13px]">{node.label}</span>}
      {!collapsed && node.badge && (
        <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-indigo-50/75">{node.badge}</span>
      )}
      {!collapsed && hasChildren && <ChevronRight className="h-4 w-4 text-indigo-50/60 transition-transform group-hover:translate-x-0.5" />}
    </>
  )

  if (node.href && !hasChildren && !node.disabled) {
    const link = (
      <Link
        href={node.href}
        target={node.external ? '_blank' : undefined}
        rel={node.external ? 'noreferrer' : undefined}
        prefetch={false}
        onMouseEnter={(event) => onOpen(event.currentTarget)}
        onClick={onNavigate}
        className={cn(rowClass, !collapsed && node.favourite && 'pr-11')}
      >
        {inner}
      </Link>
    )
    // A favourite row keeps its whole surface navigable, with the remove-star
    // overlaid on the right (a <button> can't live inside an <a>).
    if (node.favourite && !collapsed) {
      return (
        <div className="relative">
          {link}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            <FavStar favourite={node.favourite} label={node.label} />
          </div>
        </div>
      )
    }
    return link
  }

  return (
    <button
      type="button"
      disabled={node.disabled}
      onMouseEnter={(event) => onOpen(event.currentTarget)}
      onFocus={(event) => onOpen(event.currentTarget)}
      className={rowClass}
    >
      {inner}
    </button>
  )
}

function FlyoutRow({
  node,
  onOpen,
  onNavigate,
}: {
  node: NavNode
  onOpen: (el: HTMLElement | null) => void
  onNavigate: () => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const Icon = node.icon

  const rowClass = cn(
    'flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors',
    node.active ? 'bg-white/22 text-white' : 'text-indigo-50/85 hover:bg-white/16 hover:text-white',
    node.disabled && 'pointer-events-none opacity-50',
  )

  const content = (
    <>
      {Icon && <Icon className="h-4 w-4 flex-shrink-0 opacity-80" />}
      <span className="flex-1 truncate">{node.label}</span>
      {node.badge && <span className="text-[8px] font-black uppercase tracking-widest text-indigo-50/45">{node.badge}</span>}
      {hasChildren && <ChevronRight className="h-4 w-4 flex-shrink-0 text-indigo-50/60" />}
    </>
  )

  if (node.href && !hasChildren && !node.disabled) {
    return (
      <div className="flex items-center gap-1" onMouseEnter={(event) => onOpen(event.currentTarget)}>
        <Link
          href={node.href}
          target={node.external ? '_blank' : undefined}
          rel={node.external ? 'noreferrer' : undefined}
          prefetch={false}
          onClick={onNavigate}
          className={cn(rowClass, 'flex-1')}
        >
          {content}
        </Link>
        {node.favourite && <FavStar favourite={node.favourite} label={node.label} />}
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={node.disabled}
      onMouseEnter={(event) => onOpen(event.currentTarget)}
      onFocus={(event) => onOpen(event.currentTarget)}
      className={cn(rowClass, 'w-full')}
    >
      {content}
    </button>
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
/* Touch / mobile: inline tap accordion (drill-down), no hover needed. */
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

function FlyoutPanel({
  rect,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  rect: DOMRect
  children: React.ReactNode
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measure the actual panel size, then align its top with the hovered row and
  // only shift up if the real height would overflow the bottom of the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const gap = 8
    const width = el.offsetWidth
    const height = el.offsetHeight
    let left = rect.right + gap
    if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - gap)
    let top = rect.top - 6
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - height)
    setPos({ left, top })
  }, [rect])

  const maxHeight = (typeof window === 'undefined' ? 800 : window.innerHeight) - 16

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-[228px] max-w-[290px] rounded-2xl border border-white/15 bg-[#023468] p-2 shadow-2xl shadow-slate-950/50 duration-150 animate-in fade-in slide-in-from-left-1 dark:bg-[#012348]"
      style={{
        left: pos ? pos.left : rect.right + 8,
        top: pos ? pos.top : rect.top - 6,
        maxHeight,
        overflowY: 'auto',
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="space-y-1">{children}</div>
    </div>
  )
}
