'use client'

import React, { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
import {
  motion,
  animate,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'motion/react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
// type-only import: the module itself is server-only, the type is erased at compile time
import type { KiaYardStats } from '@/lib/kia/home-yard-stats'

const BRAND_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'

/**
 * Operations Hub — a pure 3D scene. No metrics, no charts, no data widgets.
 *
 * Built entirely from CSS 3D (perspective + preserve-3d + real box faces) driven by Framer Motion,
 * which is already a dependency — no WebGL runtime is loaded.
 *
 * Geometry note: the SCENE carries one isometric rotation (rotateX/rotateZ) and every solid inside it
 * is positioned purely with translateX/Y/Z in that shared space. The previous version rotated each
 * card individually and spaced them 24px apart, which made all ten collapse into one another — only
 * the topmost was visible. Slabs are now real 5-face boxes stacked along Z with a large gap.
 *
 * Hydration: every style value is a unit-bearing STRING. Passing bare numbers (width: 3) lets React
 * emit "3px" server-side while Motion applies 3 on the client — a mismatch even though the value is
 * deterministic. Decorative loops additionally render client-only.
 *
 * Colour comes from the app's dashboard/kia CSS tokens so the glow survives all 8 accent themes and
 * dark mode (raw --dashboard-action-bg is #031430 under the shipping default: invisible as a glow).
 */


// Background field: ONLY the floating capability words remain - every geometric shape
// (cubes, rings, orbs, pyramid, dot particles) was removed by request. Each chip is still a rigid
// body in the collision simulation; `r` approximates half the rendered label width.
const FIELD: FieldItem[] = [
  { id: 0, label: 'CRM',            em: true,  r: 40, depth: -180 },
  { id: 1, label: 'Growth',         em: false, r: 46, depth: -300 },
  { id: 2, label: 'Bookings',       em: false, r: 50, depth: -240 },
  { id: 3, label: 'Analytics',      em: true,  r: 51, depth: -360 },
  { id: 4, label: 'Inventory',      em: false, r: 51, depth: -200 },
  { id: 5, label: 'Workshop',       em: false, r: 50, depth: -320 },
  { id: 6, label: 'Finance',        em: true,  r: 46, depth: -160 },
  { id: 7, label: 'Real-time data', em: false, r: 60, depth: -400 },
  { id: 8, label: 'Multi-brand',    em: false, r: 55, depth: -280 },
  { id: 9, label: 'Automation',     em: false, r: 54, depth: -340 },
]

type FieldItem = { id: number; label: string; em: boolean; r: number; depth: number }

const BEAMS = [
  { id: 0, x: -26, delay: 0,   dur: 3.2 },
  { id: 1, x: 0,   delay: 0.7, dur: 3.8 },
  { id: 2, x: 26,  delay: 1.4, dur: 3.4 },
]

const CSS = `
.hub {
  --hub-accent: var(--dashboard-action-bg);
  --hub-glow: color-mix(in srgb, var(--dashboard-action-bg) 34%, transparent);
  --hub-line: color-mix(in srgb, var(--dashboard-action-bg) 18%, transparent);

  /* Emissive ramp, taken STRAIGHT from the theme's own primary ladder. Every accent theme defines
     primary-dark / primary / primary-light, so the models shade dark -> light in whatever hue the
     user is running. (The previous ramp mixed in fixed cyan/mint, which meant the scene read teal
     no matter which theme was active — that is the bug this fixes.) */
  --lume-1: var(--dashboard-primary-dark);
  --lume-2: var(--dashboard-primary);
  --lume-3: var(--dashboard-primary-light);
  --lume-edge: color-mix(in srgb, var(--dashboard-primary-light) 68%, #ffffff);
  --lume-halo: rgba(var(--dashboard-primary-rgb), 0.34);

  /* Slab bodies stay near-white so the emissive faces pop against them; sides step down in value to
     give each block a readable light/shade break instead of one flat wash. */
  --slab-top:  #ffffff;
  --slab-side: color-mix(in srgb, #ffffff 88%, var(--lume-1));
  --slab-dark: color-mix(in srgb, #ffffff 72%, var(--lume-1));
}
.dark .hub {
  --hub-accent: var(--dashboard-primary-light);
  --hub-glow:   rgba(var(--dashboard-primary-light-rgb), 0.42);
  --hub-line:   rgba(var(--dashboard-primary-light-rgb), 0.34);
  /* Dark mode: step the same theme ladder UP a stop so surfaces stay legible on a dark canvas. */
  --lume-1: var(--dashboard-primary);
  --lume-2: var(--dashboard-primary-light);
  --lume-3: color-mix(in srgb, var(--dashboard-primary-light) 58%, #ffffff);
  --lume-edge: color-mix(in srgb, var(--dashboard-primary-light) 42%, #ffffff);
  --lume-halo: rgba(var(--dashboard-primary-light-rgb), 0.46);
  --slab-top:  color-mix(in srgb, var(--kia-surface) 76%, #ffffff);
  --slab-side: color-mix(in srgb, var(--kia-surface) 92%, #000000);
  --slab-dark: color-mix(in srgb, var(--kia-surface) 76%, #000000);
}
.hub-scene { perspective: 1500px; perspective-origin: 50% 46%; }
.hub-3d    { transform-style: preserve-3d; }
.hub-emissive {
  background: linear-gradient(135deg, var(--lume-1) 0%, var(--lume-2) 52%, var(--lume-3) 100%);
}

/* Clickable plot footprints. The buildings themselves inherit pointer-events:none from the campus
   wrapper, so hit-testing passes straight through a building to the footprint link beneath it —
   clicking a roof opens the same section as clicking the forecourt. */
.hub-plotlink {
  background: transparent;
  border-radius: 18px;
  transition: background .25s var(--kia-ease-out), box-shadow .25s var(--kia-ease-out);
}
.hub-plotlink:hover,
.hub-plotlink:focus-visible {
  outline: none;
  background: color-mix(in srgb, var(--lume-2) 11%, transparent);
  box-shadow: 0 0 44px var(--lume-halo);
}

/* Day/night. The first cut was a full-screen multiply film — on a near-white scene that just looks
   like a broken grey shadow (it dimmed the entire canvas uniformly). Dusk is now an edge VIGNETTE:
   the centre of the scene stays clean, only the periphery cools and darkens slightly, plus a faint
   cool cast at the top. Peak alpha ~0.14, normal blending. Reads as atmosphere, never as a shadow. */
@keyframes hub-daynight {
  0%, 100% { opacity: 0; }
  42%, 58% { opacity: 1; }
}
.hub-night {
  background:
    radial-gradient(120% 90% at 50% 32%, transparent 44%, rgba(15, 23, 42, .14) 100%),
    linear-gradient(180deg, rgba(37, 99, 235, .05), transparent 38%);
  animation: hub-daynight 90s ease-in-out infinite;
}
/* Elements that brighten in step with the dusk cycle: same keyframes + duration as .hub-night,
   mounted in the same commit, so the timelines stay in sync without any JS coordination. */
.hub-night-sync {
  opacity: 0;
  animation: hub-daynight 90s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .hub-plotlink { transition-duration: .001ms !important; }
  .hub-night { animation: none; opacity: 0; }
  .hub-night-sync { animation: none; }
}
`

/**
 * Global master switch for homepage animations.
 * Set `ENABLE_HOMEPAGE_ANIMATIONS = false` to pause all homepage animations (3D physics, vehicle loops, helicopter, camera sway & tilt).
 * Set `ENABLE_HOMEPAGE_ANIMATIONS = true` to re-enable animations whenever needed.
 */
export const ENABLE_HOMEPAGE_ANIMATIONS = false

export default function DashboardPortal() {
  const reduce = useReducedMotion()
  const isClient = useSyncExternalStore(NEVER_CHANGES, onClient, onServer)
  const isDesktop = useIsDesktop()
  const animated = ENABLE_HOMEPAGE_ANIMATIONS && !reduce

  // Power gate: the whole animated layer (physics sim, 3 vehicle loops, helicopter, walkers,
  // pulses, dusk cycle) unmounts when the hero is scrolled out of view OR the tab is hidden —
  // otherwise it all keeps burning CPU behind other content. State flips only inside the
  // IntersectionObserver / visibilitychange callbacks (async, lint-clean); the static campus
  // stays mounted so scrolling back never shows a hole.
  const [sceneActive, setSceneActive] = useState(true)
  const sceneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sceneRef.current
    if (!el) return
    let inView = true
    let tabVisible = !document.hidden
    const apply = () => setSceneActive(inView && tabVisible)
    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true
      apply()
    }, { threshold: 0.04 })
    io.observe(el)
    const onVis = () => { tabVisible = !document.hidden; apply() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const decor = animated && isClient && sceneActive

  const [active, setActive] = useState<string | null>(null)

  // Real counts for the yard rows (New Stock / Demo Fleet / Ready for Delivery), from the same
  // definitions as the Stock Report, Demo Cars List and allotment flow. The endpoint is gated on
  // kia.stock_report.view; a 403 lands in the error branch and the labels simply render without
  // numbers, so ungranted roles see exactly what they saw before.
  const yardStatsQuery = useQuery<KiaYardStats>({
    queryKey: ['kia-home-yard-stats'],
    enabled: isClient && isDesktop,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/home/yard-stats')
      if (!res.ok) throw new Error('yard stats unavailable')
      return res.json()
    },
  })
  const yardCounts = yardStatsQuery.data

  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 70, damping: 20, mass: 0.7 })
  const sy = useSpring(my, { stiffness: 70, damping: 20, mass: 0.7 })
  const rotZ = useTransform(sx, [-0.5, 0.5], [-52, -38])
  const rotX = useTransform(sy, [-0.5, 0.5], [64, 52])

  const onMove = useCallback((e: React.PointerEvent) => {
    if (reduce || !ENABLE_HOMEPAGE_ANIMATIONS) return
    const el = sceneRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }, [mx, my, reduce])

  const onLeave = useCallback(() => { mx.set(0); my.set(0) }, [mx, my])

  // Idle cinematography: after 6s without pointer movement the camera starts a slow sway, so the
  // scene is never frozen even untouched. It drives the same mx motion value the mouse parallax
  // uses (through the same spring), and any pointer activity stops it instantly. The keyframe loop
  // starts AND ends at the value it began from, so each 22s cycle wraps seamlessly.
  useEffect(() => {
    // Also parked while the scene is off-screen/hidden — no point swaying an invisible campus.
    if (reduce || !sceneActive || !ENABLE_HOMEPAGE_ANIMATIONS) return
    let sway: ReturnType<typeof animate> | null = null
    let timer = 0
    const startSway = () => {
      const from = mx.get()
      sway = animate(mx, [from, 0.16, -0.16, from], {
        duration: 22, repeat: Infinity, ease: 'easeInOut',
      })
    }
    const reset = () => {
      sway?.stop()
      sway = null
      window.clearTimeout(timer)
      timer = window.setTimeout(startSway, 6000)
    }
    window.addEventListener('pointermove', reset)
    reset()
    return () => {
      window.removeEventListener('pointermove', reset)
      window.clearTimeout(timer)
      sway?.stop()
    }
  }, [reduce, mx, sceneActive])

  return (
    <MainLayout title="Operations Hub" subtitle="AM Group Corporate Gateway">
      <div className="hub kia-premium relative mx-auto w-full max-w-[1400px] pb-8">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />

        <div
          ref={sceneRef}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          className="hub-scene relative min-h-[calc(100vh-9rem)] overflow-hidden rounded-[2.5rem]"
        >
          {/* Ambient glows - STATIC by request: no moving background objects except text. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -left-32 top-0 h-[480px] w-[480px] rounded-full"
            style={{ background: 'radial-gradient(circle, var(--hub-glow), transparent 68%)', filter: 'blur(50px)', opacity: 0.4 }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -right-36 bottom-0 h-[440px] w-[440px] rounded-full"
            style={{ background: 'radial-gradient(circle, var(--hub-glow), transparent 70%)', filter: 'blur(56px)', opacity: 0.32 }}
          />

          {/* Grid floor */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] hub-3d">
            <div
              className="absolute inset-0"
              style={{
                transform: 'rotateX(74deg)',
                transformOrigin: 'center bottom',
                backgroundImage:
                  'linear-gradient(var(--hub-line) 1px, transparent 1px), linear-gradient(90deg, var(--hub-line) 1px, transparent 1px)',
                backgroundSize: '60px 60px',
                maskImage: 'linear-gradient(to top, #000 0%, transparent 76%)',
                WebkitMaskImage: 'linear-gradient(to top, #000 0%, transparent 76%)',
                opacity: '0.5',
              }}
            />
          </div>

          {/* ── Background field: capability words floating in space ─── */}
          {/* Desktop-only: on a phone-sized canvas 17 bodies pile onto the copy. */}
          {isDesktop && <PhysicsField />}

          {/* ── Copy ────────────────────────────────────────────────────── */}
          <motion.div
            initial={animated ? { opacity: 0, y: 20 } : false}
            animate={animated ? { opacity: 1, y: 0 } : false}
            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-20 max-w-lg px-2 pt-10 sm:px-6"
          >
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--hub-accent) 10%, var(--kia-surface))',
                borderColor: 'var(--hub-line)', color: 'var(--hub-accent)',
              }}
            >
             AM Group Operating System
            </span>

            <h1
              className="mt-5 text-4xl font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-[3.4rem]"
              style={{ color: 'var(--kia-text)' }}
            >
              One system for
              <br />
              <span
                style={{
                  background: 'linear-gradient(100deg, var(--hub-accent), color-mix(in srgb, var(--hub-accent) 38%, var(--kia-text)))',
                  WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}
              >
                every dealership
              </span>
            </h1>

            <p className="mt-4 max-w-md text-[14px] font-medium leading-relaxed" style={{ color: 'var(--kia-text-soft)' }}>
              Sales, service, inventory and finance - unified across KIA, Hyundai and Platinum.
              <span className="hidden lg:inline"> Move your cursor to rotate the campus.</span>
            </p>
          </motion.div>

          {/* ── The campus: showroom, service centre, stock yard and skyline,
                 all on ONE ground plane in ONE isometric space ─────────────── */}
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[70%] items-center justify-center lg:flex">
            <div style={{ transform: 'translateY(60px) scale(0.74)' }}>
              <motion.div
                className="hub-3d relative h-[900px] w-[900px]"
                style={animated ? { rotateX: rotX, rotateZ: rotZ } : { transform: 'rotateX(58deg) rotateZ(-45deg)' }}
              >
                <Campus active={active} setActive={setActive} decor={decor} counts={yardCounts} />
              </motion.div>
            </div>
          </div>

          {/* Brand medallion: the AM Group logo, where the holo car used to float */}
          <div className="pointer-events-none absolute left-[5%] top-[42%] hidden xl:block">
            <div className="relative grid h-[190px] w-[190px] place-items-center">
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ background: 'radial-gradient(circle, var(--lume-halo), transparent 70%)', filter: 'blur(20px)' }}
              />
              <span
                aria-hidden
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: 'color-mix(in srgb, var(--lume-2) 38%, transparent)' }}
              />
              <span
                aria-hidden
                className="absolute inset-2 rounded-full border"
                style={{
                  borderColor: 'var(--hub-line)',
                  backgroundColor: 'color-mix(in srgb, var(--kia-surface) 90%, transparent)',
                  boxShadow: '0 24px 60px -24px var(--lume-halo), inset 0 1px 0 rgba(255,255,255,.8)',
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND_LOGO_URL} alt="AM Group" className="relative h-[150px] w-[150px] rounded-full object-contain" />
            </div>
          </div>

          {/* ── Day/night: a 90s ambient tint cycle. pointer-events-none so the plot links
                 underneath stay clickable; z-10 keeps it under the copy (z-20). ─────────── */}
          {decor && isDesktop && <div aria-hidden className="hub-night pointer-events-none absolute inset-0 z-10" />}

          {/* Mobile / tablet: live CSS-3D + animation loops are too heavy and too cramped on a
              phone, so below lg the campus is a single STATIC SVG vignette — same isometric
              projection, same theme tokens, zero animation, zero 3D compositing. */}
          <div className="relative z-10 mt-2 px-2 pb-8 lg:hidden">
            <MobileCampusIllustration />
          </div>
        </div>
      </div>
    </MainLayout>
  )
}

/* ── MobileCampusIllustration: the campus as a STATIC asset ──────────────
   Plain SVG polygons computed with the same 2:1 isometric projection the live scene uses, filled
   with the same theme tokens — so it reads as the desktop campus's sibling, but costs nothing:
   no animation, no preserve-3d compositing, no rAF. Rendered below lg only. */
function isoPt(x: number, y: number, z: number) {
  return `${((x - y) * 0.866).toFixed(1)},${((x + y) * 0.5 - z).toFixed(1)}`
}

function IsoBox({ x, y, z = 0, w, d, h, glow }: {
  x: number; y: number; z?: number; w: number; d: number; h: number; glow?: boolean
}) {
  // With this projection the viewer sees the top plus the two faces pointing down-screen
  // (+x and +y). Sides first, lit top last.
  return (
    <>
      <polygon
        points={[isoPt(x + w, y, z), isoPt(x + w, y + d, z), isoPt(x + w, y + d, z + h), isoPt(x + w, y, z + h)].join(' ')}
        fill="var(--slab-side)" stroke="var(--hub-line)" strokeWidth="0.6"
      />
      <polygon
        points={[isoPt(x, y + d, z), isoPt(x + w, y + d, z), isoPt(x + w, y + d, z + h), isoPt(x, y + d, z + h)].join(' ')}
        fill="var(--slab-dark)" stroke="var(--hub-line)" strokeWidth="0.6"
      />
      <polygon
        points={[isoPt(x, y, z + h), isoPt(x + w, y, z + h), isoPt(x + w, y + d, z + h), isoPt(x, y + d, z + h)].join(' ')}
        fill={glow ? 'url(#mLume)' : 'var(--slab-top)'} stroke="var(--hub-line)" strokeWidth="0.6"
      />
    </>
  )
}

function MobileCampusIllustration() {
  return (
    <svg viewBox="-185 -45 415 300" className="mx-auto block w-full max-w-[420px]" aria-hidden>
      <defs>
        <linearGradient id="mLume" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--lume-1)" />
          <stop offset="55%" stopColor="var(--lume-2)" />
          <stop offset="100%" stopColor="var(--lume-3)" />
        </linearGradient>
        <radialGradient id="mHalo">
          <stop offset="0%" stopColor="var(--lume-halo)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* ambient glow behind the campus */}
      <ellipse cx="20" cy="120" rx="200" ry="120" fill="url(#mHalo)" opacity="0.5" />

      {/* ground */}
      <IsoBox x={0} y={0} z={-8} w={260} d={200} h={8} />

      {/* showroom + emissive canopy */}
      <IsoBox x={30} y={28} w={90} d={70} h={38} />
      <IsoBox x={22} y={20} z={38} w={106} d={86} h={8} glow />

      {/* service centre + emissive roof */}
      <IsoBox x={36} y={122} w={72} d={56} h={28} />
      <IsoBox x={30} y={116} z={28} w={84} d={68} h={7} glow />

      {/* city towers */}
      <IsoBox x={168} y={18} w={46} d={46} h={106} />
      <IsoBox x={168} y={18} z={106} w={46} d={46} h={6} glow />
      <IsoBox x={202} y={64} w={34} d={34} h={66} />

      {/* stock cars on the lot */}
      {[
        { x: 150, y: 152 }, { x: 184, y: 144 }, { x: 152, y: 178 },
      ].map((c, i) => (
        <g key={i}>
          <IsoBox x={c.x} y={c.y} w={26} d={13} h={7} />
          <IsoBox x={c.x + 5} y={c.y + 2} z={7} w={13} d={9} h={5} glow />
        </g>
      ))}

      {/* light mast with its pool */}
      <ellipse cx="76" cy="194" rx="34" ry="14" fill="url(#mHalo)" opacity="0.6" />
      <IsoBox x={236} y={148} w={5} d={5} h={52} />
      <IsoBox x={232} y={144} z={52} w={13} d={13} h={4} glow />
    </svg>
  )
}

/* ── client-only gate (lint-clean; no setState in an effect) ─────────────── */
const NEVER_CHANGES = () => () => {}
const onClient = () => true
const onServer = () => false

/* ── desktop gate (Tailwind lg = 1024px) ──────────────────────────────────
   The physics field must be UNMOUNTED on small screens, not display:none-hidden: its rAF loop
   would keep simulating 17 bodies against a 0-width box behind a hidden panel. SSR snapshot is
   false; useSyncExternalStore re-renders with the real match right after hydration. */
const lgQuery = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)') : null
const subscribeLg = (cb: () => void) => {
  lgQuery?.addEventListener('change', cb)
  return () => lgQuery?.removeEventListener('change', cb)
}
const getLg = () => lgQuery?.matches ?? false
const getLgServer = () => false
function useIsDesktop() {
  return useSyncExternalStore(subscribeLg, getLg, getLgServer)
}

/* ── Campus: ONE isometric ground plane carrying every building ───────────
   Previously each model owned its own rotation root and its own ground pad, positioned by an
   independent `absolute` percentage — so nothing shared a horizon, scales were unrelated, and the
   pieces read as five separate illustrations. Everything below now lives in a single 3D space and is
   placed by translate3d on the isometric axes, so the campus reads as one location.               */

// Plot coordinates in campus space (pre-rotation). Spacing is checked against each model's own
// footprint so nothing overlaps: yard pad 410, showroom/service pads 214, city pad 210.
const PLOTS = {
  yard:    { dx: 170,  dy: 70 },
  showroom:{ dx: -268, dy: 186 },
  service: { dx: -268, dy: -170 },
  city:    { dx: 168,  dy: -330 },
}

function Plot({ dx, dy, children }: { dx: number; dy: number; children: React.ReactNode }) {
  // Zero-size anchor: Box positions itself from its parent's centre, so a 0x0 div at (dx,dy) makes
  // that point the plot origin.
  return (
    <div
      className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
      style={{ transform: `translate3d(${dx}px, ${dy}px, 0px)` }}
    >
      {children}
    </div>
  )
}

/** Billboarded plot name — counter-rotates the scene so it faces the viewer. */
function PlotLabel({ dx, dy, children }: { dx: number; dy: number; children: React.ReactNode }) {
  return (
    <div
      className="hub-3d absolute left-1/2 top-1/2 grid h-0 w-0 place-items-center"
      style={{ transform: `translate3d(${dx}px, ${dy}px, 20px)` }}
    >
      <span
        className="whitespace-nowrap rounded-full border px-3 py-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.14em]"
        style={{
          transform: 'rotateZ(45deg) rotateX(-58deg)',
          backgroundColor: 'var(--kia-surface)',
          borderColor: 'var(--hub-line)',
          color: 'var(--lume-2)',
          boxShadow: 'var(--kia-elev-1)',
        }}
      >
        {children}
      </span>
    </div>
  )
}

/** A lit service road between two plots. */
function Road({ dx, dy, w, d }: { dx: number; dy: number; w: number; d: number }) {
  return (
    <>
      <Box w={w} d={d} h={5} dx={dx} dy={dy} dz={-5} radius={4}
        bodyTop="color-mix(in srgb, var(--lume-1) 8%, #ffffff)" />
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 block"
        style={{
          width: `${w - 24}px`, height: '2px',
          marginLeft: `${dx - (w - 24) / 2}px`, marginTop: `${dy}px`,
          transform: 'translateZ(1px)',
          background: 'linear-gradient(90deg, transparent, var(--lume-2), transparent)',
          opacity: '0.5',
        }}
      />
    </>
  )
}

/* ── ServiceLoop: a car drives in, waits at the bay, gets serviced, leaves renewed ──
   One 21s keyframe timeline shared by every element (car path, flash, sparks, status chip), so the
   choreography can never drift apart. The path runs along campus y=-128 — chosen against every
   plot footprint: it skims the empty top strip of the yard pad, clears the entrance pylon (ends at
   y≈-149) and the service road, then swings into the middle bay at (-276, -104).

   The "before" car is dull grey; at the flash peak it steps to the glowing "after" car. The swap is
   a SCALE step under the flash. ⚠️ Never animate opacity on any ancestor of the 3D boxes: an
   opacity animation makes the ancestor a grouping element for its whole lifetime (Motion pins
   will-change), which forces transform-style flat and pancakes the car — even while the value
   sits at exactly 1. That was the "punched/meshed cars" bug. Transforms never group.          */
const LOOP_T = 21
const LOOP_TIMES = [0, 0.27, 0.31, 0.39, 0.445, 0.5, 0.55, 0.62, 0.92, 1]
const LOOP_X =   [470, -180, -276, -276, -276, -276, -276, -180, 470, 470]
const LOOP_Y =   [-128, -128, -104, -104, -104, -104, -104, -128, -128, -128]
const LOOP_ROT = [0, 0, 90, 90, 90, 90, 90, 0, 0, 0]
const BAY = { x: -276, y: -104 } // parked position at the middle service bay

function ServiceLoop() {
  const loop = { duration: LOOP_T, repeat: Infinity, ease: 'linear' as const }
  return (
    <>
      {/* the travelling car */}
      <motion.div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        initial={{ x: BAY.x, y: BAY.y, rotateZ: 90 }}
        animate={ENABLE_HOMEPAGE_ANIMATIONS ? { x: LOOP_X, y: LOOP_Y, rotateZ: LOOP_ROT } : false}
        transition={{ ...loop, times: LOOP_TIMES }}
      >
        {/* The before/after swap is a SCALE step, never opacity: an ancestor with animated opacity
            is a grouping element (Motion also pins will-change:opacity for the animation's whole
            life), which forces transform-style flat and pancakes the 3D car — that was the
            "punched/meshed cars" bug. Scale is a transform; transforms never group. */}
        {/* before: dull grey, no cabin glow */}
        <motion.div
          className="hub-3d"
          initial={false}
          animate={{ scale: [1, 1, 0, 0] }}
          transition={{ ...loop, times: [0, 0.44, 0.445, 1] }}
        >
          <MiniCar bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" cabinGlow={false} />
        </motion.div>
        {/* after: factory-fresh, glowing cabin + under-halo */}
        <motion.div
          className="hub-3d"
          initial={false}
          animate={{ scale: [0, 0, 1, 1] }}
          transition={{ ...loop, times: [0, 0.44, 0.445, 1] }}
        >
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 block rounded-full"
            style={{
              width: '84px', height: '84px', marginLeft: '-42px', marginTop: '-42px',
              transform: 'translateZ(1px)',
              background: 'radial-gradient(circle, var(--lume-halo), transparent 68%)',
            }}
          />
          <MiniCar />
        </motion.div>
      </motion.div>

      {/* service flash — a ground shockwave at the bay, peaking exactly at the car swap */}
      <motion.span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full border-2"
        style={{
          width: '90px', height: '90px',
          marginLeft: `${BAY.x - 45}px`, marginTop: `${BAY.y - 45}px`,
          borderColor: 'var(--lume-2)', boxShadow: '0 0 30px var(--lume-halo)',
        }}
        initial={false}
        animate={{ opacity: [0, 0, 0.9, 0, 0], scale: [0.3, 0.3, 1, 1.7, 1.7] }}
        transition={{ ...loop, times: [0, 0.4, 0.445, 0.52, 1] }}
      />

      {/* sparks kicked out while the work happens */}
      {[{ ox: -30, oy: -14 }, { ox: 26, oy: -20 }, { ox: 8, oy: 24 }].map((sp, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute left-1/2 top-1/2 block h-[5px] w-[5px] rounded-full"
          style={{
            marginLeft: `${BAY.x - 2}px`, marginTop: `${BAY.y - 2}px`,
            backgroundColor: 'var(--lume-2)', boxShadow: '0 0 10px var(--lume-2)',
          }}
          initial={false}
          animate={{
            opacity: [0, 0, 1, 0, 0],
            x: [0, 0, sp.ox, sp.ox * 1.6, sp.ox * 1.6],
            y: [0, 0, sp.oy, sp.oy * 1.6, sp.oy * 1.6],
          }}
          transition={{ ...loop, times: [0, 0.4 + i * 0.012, 0.45 + i * 0.012, 0.5 + i * 0.012, 1] }}
        />
      ))}

      {/* Billboarded status chip. Animated by SCALE, not opacity (opacity mid-fade forces
          preserve-3d flat and would skew the billboard). Three layers so no element carries BOTH a
          static string transform and a Motion-animated one — Motion replaces the whole transform,
          which would clobber the anchor offset or the billboard rotation. */}
      <div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        style={{ transform: `translate3d(${BAY.x}px, ${BAY.y - 52}px, 44px)` }}
      >
        <motion.div
          className="hub-3d grid place-items-center"
          initial={false}
          animate={{ scale: [0, 0, 1, 1, 0, 0] }}
          transition={{ ...loop, times: [0, 0.32, 0.35, 0.52, 0.55, 1] }}
        >
          <span
            className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em]"
            style={{
              transform: 'rotateZ(45deg) rotateX(-58deg)',
              backgroundColor: 'var(--kia-surface)',
              borderColor: 'color-mix(in srgb, var(--lume-2) 55%, transparent)',
              color: 'var(--lume-2)',
              boxShadow: '0 8px 22px -10px var(--lume-halo)',
            }}
          >
            Service in progress
          </span>
        </motion.div>
      </div>
    </>
  )
}

/* ── NewStockDelivery: a transporter brings a car for the New Stock row ──────
   Same single-timeline pattern as ServiceLoop, on a 16s period (13 vs 16 share no small multiple,
   so the two loops drift phase and the scene never looks mechanical). Lane is campus y=-80 —
   between the service car's lane (-128) and the New Stock row (-42) — checked clear of the masts
   (they end at y≈-105) and the entrance pylon. The truck stops over the row's FIRST slot, which
   StockYard leaves empty when `delivery` is on; the carried car slides off sideways into it, the
   truck backs out the way it came (cab faces -x, so reversing out is the honest move), and near
   the loop's end a scan-ring pulse covers the car's step-reset back onto the returning truck. */
const DROP = { x: 30, y: -42 } // the empty New Stock slot (yard dx -140)
const TRUCK_T = 26
const TRUCK_TIMES = [0, 0.25, 0.42, 0.7, 1]
const TRUCK_X = [470, DROP.x, DROP.x, 470, 470]
const CARGO_TIMES = [0, 0.25, 0.3, 0.4, 1]
const CARGO_X = [470, DROP.x, DROP.x, DROP.x, DROP.x]
const CARGO_Y = [-80, -80, -80, DROP.y, DROP.y]
const CARGO_Z = [14, 14, 14, 0, 0]

function NewStockDelivery() {
  const loop = { duration: TRUCK_T, repeat: Infinity, ease: 'linear' as const }
  const tyre = { bodyTop: '#475569', bodySide: '#1e293b', bodyDark: '#0f172a' }
  return (
    <>
      {/* the transporter */}
      <motion.div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        initial={{ x: DROP.x, y: -80 }}
        animate={ENABLE_HOMEPAGE_ANIMATIONS ? { x: TRUCK_X, y: [-80, -80, -80, -80, -80] } : false}
        transition={{ ...loop, times: TRUCK_TIMES }}
      >
        {/* six wheels */}
        {[-24, 2, 24].map((wx) => (
          <React.Fragment key={wx}>
            <Box w={10} d={6} h={10} dx={wx} dy={-13} dz={0} radius={3} {...tyre} />
            <Box w={10} d={6} h={10} dx={wx} dy={13} dz={0} radius={3} {...tyre} />
          </React.Fragment>
        ))}
        {/* flatbed + cab (cab at the -x end: it drives in nose-first, backs out) */}
        <Box w={66} d={26} h={8} dx={4} dz={6} radius={4} />
        <Box w={20} d={26} h={20} dx={-36} dz={4} radius={5} glowTop />
        {/* rear marker light */}
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 block rounded-full"
          style={{
            width: '4px', height: '10px', marginLeft: '35px', marginTop: '-5px',
            transform: 'translateZ(10px)',
            background: '#f43f5e', boxShadow: '0 0 8px rgba(244,63,94,.7)', opacity: '0.85',
          }}
        />
      </motion.div>

      {/* the cargo: rides the flatbed in perfect sync */}
      <motion.div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        initial={{ x: DROP.x, y: -80, z: 14 }}
        animate={ENABLE_HOMEPAGE_ANIMATIONS ? { x: CARGO_X, y: CARGO_Y, z: CARGO_Z, scale: [1, 1, 1, 1, 1, 0, 0] } : false}
        transition={{
          ...loop,
          x: { ...loop, times: CARGO_TIMES },
          y: { ...loop, times: CARGO_TIMES },
          z: { ...loop, times: CARGO_TIMES },
          scale: { ...loop, times: [0, 0.25, 0.3, 0.4, 0.85, 0.855, 1] },
        }}
      >
        <MiniCar />
      </motion.div>

      {/* intake scan — covers the cargo's step-reset, reads as "registered into inventory" */}
      <motion.span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full border-2"
        style={{
          width: '70px', height: '70px',
          marginLeft: `${DROP.x - 35}px`, marginTop: `${DROP.y - 35}px`,
          borderColor: 'var(--lume-3)', boxShadow: '0 0 24px var(--lume-halo)',
        }}
        initial={false}
        animate={{ opacity: [0, 0, 0.85, 0, 0], scale: [0.4, 0.4, 1, 1.6, 1.6] }}
        transition={{ ...loop, times: [0, 0.84, 0.86, 0.9, 1] }}
      />
    </>
  )
}

/* ── CustomerHandover: a sold car leaves the Ready row and is delivered at the showroom ──
   Third and final vehicle loop, on a 19s period — 13, 16 and 19 share no common factor, so the
   three loops drift phase forever. The car IS the first Ready for Delivery slot (StockYard leaves
   it empty, same mechanic as the delivery drop): it pulls out, drives the showroom road, pauses
   for the handover flash + "Delivered" chip, then turns south and exits the campus — sold. It
   steps back into the slot under a restock pulse before the loop restarts. */
const HAND_T = 31
const HAND_TIMES = [0, 0.12, 0.32, 0.42, 0.48, 0.685, 0.7, 0.81, 0.825, 1]
const HAND_X = [30, 30, -120, -120, -120, -120, -120, 30, 30, 30]
const HAND_Y = [182, 182, 186, 186, 230, 470, 470, 182, 182, 182]
const HAND_ROT = [0, 0, 0, 0, 90, 90, 90, 0, 0, 0]
const HANDOVER = { x: -120, y: 186 } // the handover point on the showroom road

function CustomerHandover() {
  const loop = { duration: HAND_T, repeat: Infinity, ease: 'linear' as const }
  return (
    <>
      {/* the sold car */}
      <motion.div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        initial={{ x: HANDOVER.x, y: HANDOVER.y, rotateZ: 0 }}
        animate={ENABLE_HOMEPAGE_ANIMATIONS ? { x: HAND_X, y: HAND_Y, rotateZ: HAND_ROT, scale: [1, 1, 1, 1, 1, 1, 0, 0, 1, 1] } : false}
        transition={{
          ...loop,
          x: { ...loop, times: HAND_TIMES },
          y: { ...loop, times: HAND_TIMES },
          rotateZ: { ...loop, times: HAND_TIMES },
          scale: { ...loop, times: [0, 0.12, 0.32, 0.42, 0.48, 0.68, 0.685, 0.815, 0.82, 1] },
        }}
      >
        <MiniCar />
      </motion.div>

      {/* handover flash — mint, to read as success rather than work */}
      <motion.span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full border-2"
        style={{
          width: '84px', height: '84px',
          marginLeft: `${HANDOVER.x - 42}px`, marginTop: `${HANDOVER.y - 42}px`,
          borderColor: 'var(--lume-3)', boxShadow: '0 0 28px var(--lume-halo)',
        }}
        initial={false}
        animate={{ opacity: [0, 0, 0.9, 0, 0], scale: [0.4, 0.4, 1, 1.7, 1.7] }}
        transition={{ ...loop, times: [0, 0.34, 0.38, 0.44, 1] }}
      />

      {/* billboarded "Delivered" chip — same three-layer pattern as the service chip */}
      <div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        style={{ transform: `translate3d(${HANDOVER.x}px, ${HANDOVER.y - 52}px, 44px)` }}
      >
        <motion.div
          className="hub-3d grid place-items-center"
          initial={false}
          animate={{ scale: [0, 0, 1, 1, 0, 0] }}
          transition={{ ...loop, times: [0, 0.32, 0.35, 0.44, 0.47, 1] }}
        >
          <span
            className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.12em]"
            style={{
              transform: 'rotateZ(45deg) rotateX(-58deg)',
              backgroundColor: 'var(--kia-surface)',
              borderColor: 'color-mix(in srgb, var(--lume-3) 60%, transparent)',
              color: 'var(--lume-3)',
              boxShadow: '0 8px 22px -10px var(--lume-halo)',
            }}
          >
            Delivered
          </span>
        </motion.div>
      </div>

      {/* restock pulse over the Ready slot, covering the car's step-reset */}
      <motion.span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full border-2"
        style={{
          width: '70px', height: '70px',
          marginLeft: `${30 - 35}px`, marginTop: `${182 - 35}px`,
          borderColor: 'var(--lume-2)', boxShadow: '0 0 24px var(--lume-halo)',
        }}
        initial={false}
        animate={{ opacity: [0, 0, 0.8, 0, 0], scale: [0.4, 0.4, 1, 1.6, 1.6] }}
        transition={{ ...loop, times: [0, 0.8, 0.83, 0.88, 1] }}
      />
    </>
  )
}

/* ── CampusPeople: tiny walkers entering and leaving the venues ──────────
   Each walker strolls its path over the first ~62% of its loop, then "enters the building": hidden
   via a SCALE step (never opacity — an animated-opacity ancestor flattens preserve-3d children; see
   the ServiceLoop note) and quietly resets to its start point while invisible. Durations are all
   different and offset from the vehicle periods, so the foot traffic never syncs with the cars.
   Paths are checked against building footprints AND both vehicle lanes (truck y=-80 stops at x=30;
   the sold car's southbound run occupies x -134..-106). */
const WALKERS: { path: [number, number][]; dur: number; delay: number; shirt: string }[] = [
  // showroom: door on the east glass face (~-196, 193)
  { path: [[-92, 216], [-150, 204], [-196, 193]], dur: 18, delay: 0, shirt: 'var(--lume-1)' },
  { path: [[-198, 190], [-140, 201], [-86, 215]], dur: 21, delay: 7, shirt: '#64748b' },
  // service centre: door on the south face beside the bays (~-224, -138)
  { path: [[-150, -84], [-224, -136]], dur: 17, delay: 3, shirt: 'var(--lume-2)' },
  { path: [[-228, -140], [-170, -98], [-120, -82]], dur: 20, delay: 11, shirt: '#94a3b8' },
  // city offices: tallest tower's lobby (~158, -366), approached from the plate's south edge
  { path: [[180, -218], [172, -292], [158, -366]], dur: 22, delay: 5, shirt: '#475569' },
  { path: [[154, -368], [168, -298], [178, -222]], dur: 19, delay: 14, shirt: 'var(--lume-1)' },
]

function Person({ shirt }: { shirt: string }) {
  return (
    <>
      {/* contact shadow */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full"
        style={{
          width: '10px', height: '7px', marginLeft: '-5px', marginTop: '-3.5px',
          transform: 'translateZ(0.5px)',
          background: 'rgba(15,23,42,.16)', filter: 'blur(1.5px)',
        }}
      />
      {/* torso (shirt) + head (skin sides, hair top) */}
      <Box w={5} d={5} h={9} radius={2}
        bodyTop={shirt}
        bodySide={`color-mix(in srgb, ${shirt} 82%, #0f172a)`}
        bodyDark={`color-mix(in srgb, ${shirt} 68%, #0f172a)`}
      />
      <Box w={4} d={4} h={4} dz={9} radius={2}
        bodyTop="#1e293b" bodySide="#eab892" bodyDark="#d9a06f" />
    </>
  )
}

function Walker({ path, dur, delay, shirt }: {
  path: [number, number][]; dur: number; delay: number; shirt: string
}) {
  const walkEnd = 0.62
  const xs = path.map((p) => p[0])
  const ys = path.map((p) => p[1])
  const posTimes = [...path.map((_, i) => (i / (path.length - 1)) * walkEnd), 1]
  const loop = { duration: dur, repeat: Infinity, ease: 'linear' as const, delay }
  return (
    <motion.div
      aria-hidden
      className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
      initial={{ x: xs[0], y: ys[0], scale: 1 }}
      animate={ENABLE_HOMEPAGE_ANIMATIONS ? { x: [...xs, xs[xs.length - 1]], y: [...ys, ys[ys.length - 1]], scale: [1, 1, 0, 0] } : false}
      transition={{
        ...loop,
        x: { ...loop, times: posTimes },
        y: { ...loop, times: posTimes },
        scale: { ...loop, times: [0, walkEnd, walkEnd + 0.01, 1] },
      }}
    >
      {/* gait bob, independent high-frequency loop */}
      <motion.div
        className="hub-3d"
        initial={false}
        animate={ENABLE_HOMEPAGE_ANIMATIONS ? { z: [0, 1.6, 0] } : false}
        transition={{ duration: 0.55, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Person shirt={shirt} />
      </motion.div>
    </motion.div>
  )
}

function CampusPeople() {
  return (
    <>
      {WALKERS.map((w, i) => (
        <Walker key={i} {...w} />
      ))}
    </>
  )
}

/* A clickable plot footprint. Lies flat in the ground plane over the whole plot; the buildings
   inherit pointer-events:none from the campus wrapper, so hit-testing passes straight through a
   roof to this link — clicking a building opens its section. */
function PlotLink({ dx, dy, w, d, href, label, onHover }: {
  dx: number; dy: number; w: number; d: number; href: string; label: string
  onHover: (v: string | null) => void
}) {
  return (
    <div
      className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
      style={{ transform: `translate3d(${dx}px, ${dy}px, 2px)` }}
    >
      <Link
        href={href}
        prefetch={false}
        aria-label={label}
        className="hub-plotlink pointer-events-auto absolute block cursor-pointer"
        style={{ width: `${w}px`, height: `${d}px`, marginLeft: `${-w / 2}px`, marginTop: `${-d / 2}px` }}
        onPointerEnter={() => onHover(label)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(label)}
        onBlur={() => onHover(null)}
      />
    </div>
  )
}

/** Billboarded "Open …" hint floating above a plot while it is hovered. */
function PlotHint({ dx, dy, z, children }: { dx: number; dy: number; z: number; children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="hub-3d absolute left-1/2 top-1/2 grid h-0 w-0 place-items-center"
      style={{ transform: `translate3d(${dx}px, ${dy}px, ${z}px)` }}
    >
      <span
        className="whitespace-nowrap rounded-full border px-3 py-1.5 text-[11.5px] font-extrabold tracking-tight"
        style={{
          transform: 'rotateZ(45deg) rotateX(-58deg)',
          backgroundColor: 'color-mix(in srgb, var(--lume-2) 14%, var(--kia-surface))',
          borderColor: 'color-mix(in srgb, var(--lume-2) 60%, transparent)',
          color: 'var(--lume-2)',
          boxShadow: '0 10px 30px -12px var(--lume-halo)',
        }}
      >
        {children} →
      </span>
    </div>
  )
}

/* ── Helicopter: the scene's only actor above the ground plane ───────────
   Parked on the city tower's helipad, it periodically lifts off, patrols the whole campus at
   cruise altitude (z=300 — above the pylon beams at ~294 and the holo panel sits higher still),
   and returns. Heading (rotateZ) advances monotonically through the circuit and ends at the start
   angle +360, so the loop-boundary snap is numerically large but visually invisible. */
const HELI_T = 36
const HELI_TIMES = [0, 0.1, 0.15, 0.3, 0.46, 0.62, 0.76, 0.86, 0.9, 1]
const HELI_X = [154, 154, 154, 350, 160, -180, -60, 154, 154, 154]
const HELI_Y = [-390, -390, -390, -120, 180, 60, -260, -390, -390, -390]
const HELI_Z = [190, 190, 300, 300, 300, 300, 300, 300, 190, 190]
const HELI_ROT = [54, 54, 54, 122, 199, 291, 329, 414, 414, 414]

function Helicopter() {
  const loop = { duration: HELI_T, repeat: Infinity, ease: 'easeInOut' as const }
  return (
    <motion.div
      aria-hidden
      className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
      initial={{ x: 154, y: -390, z: 190, rotateZ: 54 }}
      animate={ENABLE_HOMEPAGE_ANIMATIONS ? { x: HELI_X, y: HELI_Y, z: HELI_Z, rotateZ: HELI_ROT } : false}
      transition={{ ...loop, times: HELI_TIMES }}
    >
      {/* skids */}
      <Box w={12} d={2} h={2} dy={-5} dz={0} radius={1} bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" />
      <Box w={12} d={2} h={2} dy={5} dz={0} radius={1} bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" />
      {/* cabin + tail boom */}
      <Box w={14} d={10} h={8} dz={2} radius={4} glowTop />
      <Box w={12} d={3} h={3} dx={-12} dz={6} radius={1} />
      {/* rotor: static-lift wrapper + spinning blade */}
      <span aria-hidden className="absolute left-1/2 top-1/2 block" style={{ transform: 'translateZ(13px)' }}>
        <span
          data-kia-motion=""
          className="block rounded-full"
          style={{
            width: '34px', height: '2.5px', marginLeft: '-17px', marginTop: '-1px',
            background: 'linear-gradient(90deg, transparent, var(--lume-2), transparent)',
            animation: ENABLE_HOMEPAGE_ANIMATIONS ? 'kia-spin .22s linear infinite' : 'none', opacity: '0.85',
          }}
        />
      </span>
      {/* tail beacon */}
      <span
        aria-hidden
        data-kia-motion=""
        className={`absolute left-1/2 top-1/2 block rounded-full ${ENABLE_HOMEPAGE_ANIMATIONS ? 'animate-pulse' : ''}`}
        style={{
          width: '4px', height: '4px', marginLeft: '-20px', marginTop: '-2px',
          transform: 'translateZ(9px)',
          background: '#f43f5e', boxShadow: '0 0 8px rgba(244,63,94,.8)',
        }}
      />
    </motion.div>
  )
}

/* ── HoloPanel + DataPulses: why the campus exists ───────────────────────
   A translucent "AM OS · LIVE" panel floats high above the campus centre, and pulses of light rise
   into it from every building — the dealership below feeding the system above. The viz is
   deliberately ABSTRACT (unlabelled bars + a sparkline path): it suggests telemetry without
   fabricating a single figure. */
function HoloPanel() {
  const bars = [14, 22, 17, 26, 20]
  return (
    <div
      aria-hidden
      className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
      style={{ transform: 'translate3d(-40px, -70px, 330px)' }}
    >
      <motion.div
        className="hub-3d grid place-items-center"
        initial={false}
        animate={ENABLE_HOMEPAGE_ANIMATIONS ? { z: [0, 14, 0] } : false}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div
          className="w-[216px] rounded-2xl border p-3"
          style={{
            transform: 'rotateZ(45deg) rotateX(-58deg)',
            backgroundColor: 'color-mix(in srgb, var(--kia-surface) 72%, transparent)',
            borderColor: 'var(--lume-edge)',
            boxShadow: '0 0 40px var(--lume-halo), 0 18px 50px -20px var(--lume-halo)',
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              data-kia-motion=""
              className="block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ backgroundColor: 'var(--lume-3)', boxShadow: '0 0 8px var(--lume-halo)' }}
            />
            <span className="text-[9.5px] font-extrabold uppercase tracking-[0.18em]" style={{ color: 'var(--lume-2)' }}>
              AM OS · Live
            </span>
          </div>
          <div className="mt-2 flex items-end gap-1.5" style={{ height: '28px' }}>
            {bars.map((h, i) => (
              <motion.span
                key={i}
                className="w-[10px] rounded-sm"
                style={{
                  height: `${h}px`, transformOrigin: 'bottom',
                  background: 'linear-gradient(to top, var(--lume-1), var(--lume-2))',
                  opacity: 0.85,
                }}
                initial={false}
                animate={{ scaleY: [1, 0.72, 1, 0.88, 1] }}
                transition={{ duration: 4 + i * 0.7, repeat: Infinity, ease: 'easeInOut', delay: i * 0.35 }}
              />
            ))}
          </div>
          <svg viewBox="0 0 190 26" className="mt-2 block w-full" aria-hidden>
            <motion.path
              d="M 2 20 L 28 14 L 52 17 L 78 9 L 104 13 L 132 6 L 160 10 L 188 3"
              fill="none" stroke="var(--lume-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: [0, 1] }}
              transition={{ duration: 5, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }}
            />
          </svg>
        </div>
      </motion.div>
    </div>
  )
}

const PULSE_EMITTERS = [
  { x: -268, y: 186, z: 86 },   // showroom canopy
  { x: -268, y: -170, z: 76 },  // service centre roof
  { x: 170, y: -162, z: 148 },  // yard entrance pylon
  { x: 154, y: -390, z: 212 },  // city tower antenna
]

function DataPulses() {
  return (
    <>
      {PULSE_EMITTERS.map((e, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute left-1/2 top-1/2 block rounded-full"
          style={{
            width: '5px', height: '5px', marginLeft: '-2.5px', marginTop: '-2.5px',
            backgroundColor: 'var(--lume-2)', boxShadow: '0 0 10px var(--lume-halo)',
          }}
          initial={{ x: e.x, y: e.y, z: e.z, opacity: 0 }}
          animate={{
            x: [e.x, e.x, -40, -40],
            y: [e.y, e.y, -70, -70],
            z: [e.z, e.z, 322, 322],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: 3.4, times: [0, 0.15, 0.85, 1],
            repeat: Infinity, repeatDelay: 1.3, delay: i * 1.1, ease: 'easeIn',
          }}
        />
      ))}
    </>
  )
}

const PLOT_LINKS = [
  { key: 'showroom', ...{ dx: -268, dy: 186 }, w: 214, d: 214, href: '/brands/kia/proforma', hint: 'Open Bookings', hintZ: 120 },
  { key: 'service', ...{ dx: -268, dy: -170 }, w: 214, d: 214, href: '/brands/kia/business-excellence', hint: 'Open Service', hintZ: 112 },
  { key: 'yard', ...{ dx: 170, dy: 70 }, w: 410, d: 410, href: '/brands/kia/stock-report', hint: 'Open Stock Report', hintZ: 64 },
] as const

function Campus({ active, setActive, decor, counts }: {
  active: string | null; setActive: (v: string | null) => void; decor: boolean
  counts?: KiaYardStats
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  // The scene loads fully assembled (the build-in intro was removed by request); traffic runs
  // whenever decor does.
  const traffic = decor

  return (
    <>
      {/* the single shared ground everything stands on */}
      <Box w={920} d={920} h={16} dx={-40} dy={-70} dz={-34} radius={48} />

      {/* service roads linking the plots to the yard */}
      <Road dx={-90} dy={186} w={150} d={40} />
      <Road dx={-90} dy={-150} w={150} d={40} />

      {/* Footprint links FIRST in the DOM: the yard's row-label buttons render later, so they win
          hit-testing over the yard link while everything else falls through to the footprints. */}
      {PLOT_LINKS.map((p) => (
        <PlotLink
          key={p.key}
          dx={p.dx} dy={p.dy} w={p.w} d={p.d}
          href={p.href} label={p.hint}
          onHover={setHovered}
        />
      ))}

      <Plot {...PLOTS.city}><CityBody /></Plot>

      <Plot {...PLOTS.service}><ServiceCentreBody /></Plot>
      <PlotLabel dx={PLOTS.service.dx} dy={PLOTS.service.dy + 132}>Service Centre</PlotLabel>

      <Plot {...PLOTS.showroom}><ShowroomBody /></Plot>
      <PlotLabel dx={PLOTS.showroom.dx} dy={PLOTS.showroom.dy + 132}>Showroom</PlotLabel>

      <Plot {...PLOTS.yard}>
        <StockYard active={active} setActive={setActive} decor={decor} delivery={decor} counts={counts} />
      </Plot>

      {/* hover hints, above everything on their plot */}
      {PLOT_LINKS.map((p) => (
        hovered === p.hint ? <PlotHint key={p.key} dx={p.dx} dy={p.dy} z={p.hintZ}>{p.hint}</PlotHint> : null
      ))}

      {/* the service visit car at the service bay */}
      <ServiceLoop />

      {/* the transporter bringing new stock to the yard */}
      <NewStockDelivery />

      {/* a sold car at the showroom handover */}
      <CustomerHandover />

      {/* the patrol helicopter, and the system the whole campus feeds */}
      <Helicopter />
      <HoloPanel />
      {ENABLE_HOMEPAGE_ANIMATIONS && <DataPulses />}

      {/* foot traffic in and out of the showroom, service centre and offices */}
      <CampusPeople />
    </>
  )
}

const YARD_ROWS = [
  { dy: -112, label: 'New Stock' },
  { dy: 0,    label: 'Demo Fleet' },
  { dy: 112,  label: 'Ready for Delivery' },
]
const YARD_COLS = [-140, -70, 0, 70, 140]
const YARD_POLES = [
  { dx: -186, dy: -186 }, { dx: 186, dy: -186 },
  { dx: -186, dy: 186 },  { dx: 186, dy: 186 },
]

// Which stat feeds which row label.
const YARD_COUNT_KEY: Record<string, keyof KiaYardStats> = {
  'New Stock': 'newStock',
  'Demo Fleet': 'demoFleet',
  'Ready for Delivery': 'readyForDelivery',
}

function StockYard({ active, setActive, decor, delivery, counts }: {
  active: string | null; setActive: (v: string | null) => void; decor: boolean
  // When the delivery loop is running, the first New Stock slot is left empty for it to fill —
  // the animated delivered car occupies exactly that position. Mobile (no campus, no loop)
  // omits the prop and renders the full row.
  delivery?: boolean
  // Real counts (kia.stock_report.view holders only); undefined renders plain labels.
  counts?: KiaYardStats
}) {
  return (
    <>
      {/* the lot */}
      <Box w={410} d={410} h={14} dz={-14} radius={20} />

      {/* painted aisle lines */}
      {[-56, 56].map((y) => (
        <span
          key={y}
          aria-hidden
          className="absolute left-1/2 top-1/2 block"
          style={{
            width: '360px', height: '2px',
            marginLeft: '-180px', marginTop: `${y}px`,
            transform: 'translateZ(1px)',
            background: 'var(--lume-2)', opacity: '0.45',
          }}
        />
      ))}

      {/* bays of vehicles */}
      {YARD_ROWS.map((row) => {
        const on = active === row.label
        // Two first-column slots belong to the vehicle loops: New Stock receives the transporter's
        // drop, Ready for Delivery is where the handover car parks between departures.
        const cols = delivery && (row.label === 'New Stock' || row.label === 'Ready for Delivery')
          ? YARD_COLS.filter((dx) => dx !== -140)
          : YARD_COLS
        return (
          <div key={row.label} className="hub-3d">
            {cols.map((dx) => (
              <YardCar key={dx} dx={dx} dy={row.dy} lit={on} />
            ))}
            {/* Billboarded row label. The wrapper MUST carry preserve-3d (hub-3d) — without it the
                child's rotateX is flattened into the parent's plane and the counter-rotation comes
                out as a 2D skew instead of turning the text to face the viewer. */}
            <div
              className="hub-3d absolute left-1/2 top-1/2 grid place-items-center"
              style={{
                width: '180px', height: '34px',
                marginLeft: '-286px', marginTop: `${row.dy - 17}px`,
                transform: 'translateZ(16px)',
              }}
            >
              <button
                type="button"
                onMouseEnter={() => setActive(row.label)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(row.label)}
                onBlur={() => setActive(null)}
                className="pointer-events-auto whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-extrabold tracking-tight"
                style={{
                  transform: 'rotateZ(45deg) rotateX(-58deg)',
                  backgroundColor: on
                    ? 'color-mix(in srgb, var(--lume-2) 16%, var(--kia-surface))'
                    : 'var(--kia-surface)',
                  borderColor: on
                    ? 'color-mix(in srgb, var(--lume-2) 60%, transparent)'
                    : 'var(--hub-line)',
                  color: 'var(--lume-2)',
                  boxShadow: on ? '0 6px 20px -8px var(--lume-halo)' : 'var(--kia-elev-1)',
                  cursor: 'pointer',
                }}
              >
                {row.label}
                {counts && (
                  <span
                    className="ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-black"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--lume-2) 14%, var(--kia-surface))',
                      color: 'var(--lume-1)',
                    }}
                  >
                    {counts[YARD_COUNT_KEY[row.label]]}
                  </span>
                )}
              </button>
            </div>
          </div>
        )
      })}

      {/* lighting masts */}
      {YARD_POLES.map((p, i) => (
        <div key={i} className="hub-3d">
          <Box w={7} d={7} h={86} dx={p.dx} dy={p.dy} dz={0} radius={3}
            bodyTop="#cbd5e1" bodySide="#e2e8f0" bodyDark="#94a3b8" />
          <Box w={22} d={22} h={6} dx={p.dx} dy={p.dy} dz={86} radius={4} glowTop />
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 block rounded-full"
            style={{
              width: '90px', height: '90px',
              marginLeft: `${p.dx - 45}px`, marginTop: `${p.dy - 45}px`,
              transform: 'translateZ(2px)',
              background: 'radial-gradient(circle, var(--lume-halo), transparent 70%)',
              opacity: '0.5',
            }}
          />
          {/* stronger pool that fades in on the dusk cycle (same 90s timeline as .hub-night) */}
          <span
            aria-hidden
            className="hub-night-sync absolute left-1/2 top-1/2 block rounded-full"
            style={{
              width: '130px', height: '130px',
              marginLeft: `${p.dx - 65}px`, marginTop: `${p.dy - 65}px`,
              transform: 'translateZ(3px)',
              background: 'radial-gradient(circle, var(--lume-halo), transparent 62%)',
            }}
          />
        </div>
      ))}

      {/* entrance pylon with its light beam */}
      <Box w={26} d={26} h={128} dx={0} dy={-232} dz={0} radius={5} />
      <Box w={44} d={44} h={16} dx={0} dy={-232} dz={128} radius={6} glowTop />

      {/* parked forklift — amber body, mast + forks facing away from the Ready row */}
      <Box w={18} d={13} h={11} dx={-182} dy={150} dz={0} radius={3}
        bodyTop="#f59e0b" bodySide="#d97706" bodyDark="#b45309" />
      <Box w={8} d={11} h={8} dx={-179} dy={150} dz={11} radius={2}
        bodyTop="#334155" bodySide="#1e293b" bodyDark="#0f172a" />
      <Box w={3} d={11} h={20} dx={-193} dy={150} dz={0} radius={1}
        bodyTop="#64748b" bodySide="#475569" bodyDark="#334155" />
      <Box w={9} d={2} h={2} dx={-199} dy={146} dz={0} radius={1}
        bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" />
      <Box w={9} d={2} h={2} dx={-199} dy={154} dz={0} radius={1}
        bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" />
      {decor && BEAMS.map((b) => (
        <motion.span
          key={b.id}
          aria-hidden
          className="absolute left-1/2 top-1/2 block"
          style={{
            width: '6px', height: '150px',
            marginLeft: `${b.x}px`, marginTop: '-232px',
            transformOrigin: 'bottom center',
            transform: 'translateZ(144px) rotateX(-90deg)',
            background: 'linear-gradient(to top, #ffffff 0%, var(--lume-2) 24%, var(--lume-1) 58%, transparent 100%)',
            filter: 'blur(2px)',
            boxShadow: '0 0 24px var(--lume-halo)',
          }}
          animate={{ opacity: [0.3, 0.95, 0.3], scaleY: [0.75, 1.2, 0.75] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: 'easeInOut', delay: b.delay }}
        />
      ))}

    </>
  )
}

/* A parked vehicle: two boxes only. Wheels are invisible at this scale from above and would
   quadruple the node count across 15 cars. */
function YardCar({ dx, dy, lit }: { dx: number; dy: number; lit: boolean }) {
  return (
    <>
      <Box w={54} d={26} h={11} dx={dx} dy={dy} dz={0} radius={6} />
      <Box w={28} d={21} h={9} dx={dx - 2} dy={dy} dz={11} radius={4} glowTop={lit} />
    </>
  )
}

/* ── Generic 3D box: five faces in the parent's shared isometric space ───── */
function Box({
  w, d, h, dx = 0, dy = 0, dz = 0, glowTop, windows, radius = 6, bodyTop, bodySide, bodyDark,
}: {
  w: number; d: number; h: number; dx?: number; dy?: number; dz?: number
  glowTop?: boolean; windows?: boolean; radius?: number
  bodyTop?: string; bodySide?: string; bodyDark?: string
}) {
  const fTop = bodyTop || 'var(--slab-top)'
  const fSide = bodySide || 'var(--slab-side)'
  const fDark = bodyDark || 'var(--slab-dark)'
  // Lit window rows, cheap: a repeating gradient on the vertical faces.
  const win = windows
    ? {
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0px 7px, var(--lume-2) 7px 10px), repeating-linear-gradient(to right, transparent 0px 6px, rgba(0,0,0,.06) 6px 9px)',
        backgroundBlendMode: 'normal' as const,
      }
    : {}
  return (
    <div
      className="hub-3d absolute left-1/2 top-1/2"
      style={{
        width: `${w}px`, height: `${d}px`,
        marginLeft: `${-w / 2}px`, marginTop: `${-d / 2}px`,
        transform: `translate3d(${dx}px, ${dy}px, ${dz}px)`,
      }}
    >
      {/* roof */}
      <div
        className={`absolute inset-0 ${glowTop ? 'hub-emissive' : ''}`}
        style={{
          borderRadius: `${radius}px`,
          transform: `translateZ(${h}px)`,
          background: glowTop ? undefined : `linear-gradient(150deg, ${fTop}, color-mix(in srgb, ${fTop} 92%, var(--lume-1)))`,
          border: glowTop ? '1px solid var(--lume-edge)' : '1px solid var(--hub-line)',
          boxShadow: glowTop
            ? '0 0 26px var(--lume-halo), inset 0 1px 0 rgba(255,255,255,.6)'
            : 'inset 0 1px 0 rgba(255,255,255,.85)',
        }}
      />
      {/* north + south */}
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          width: `${w}px`, height: `${h}px`, transformOrigin: 'top left',
          transform: 'rotateX(90deg)', background: fSide, opacity: '0.98', ...win,
        }}
      />
      <div
        className="absolute left-0 overflow-hidden"
        style={{
          top: `${d}px`, width: `${w}px`, height: `${h}px`, transformOrigin: 'top left',
          transform: 'rotateX(90deg)', background: fDark, ...win,
        }}
      />
      {/* west + east */}
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          width: `${h}px`, height: `${d}px`, transformOrigin: 'top left',
          transform: 'rotateY(-90deg)', background: fDark, ...win,
        }}
      />
      <div
        className="absolute top-0 overflow-hidden"
        style={{
          left: `${w}px`, width: `${h}px`, height: `${d}px`, transformOrigin: 'top left',
          transform: 'rotateY(-90deg)', background: fSide, ...win,
        }}
      />
    </div>
  )
}

/* ── Small solid car, used inside the showroom and on the workshop lift ──── */
function MiniCar({ dx = 0, dy = 0, dz = 0, bodyTop, bodySide, bodyDark, cabinGlow = true }: {
  dx?: number; dy?: number; dz?: number
  // Optional body override so the service loop can show a dull "before" car; defaults unchanged.
  bodyTop?: string; bodySide?: string; bodyDark?: string; cabinGlow?: boolean
}) {
  const tyre = { bodyTop: '#475569', bodySide: '#1e293b', bodyDark: '#0f172a' }
  const body = bodyTop ? { bodyTop, bodySide, bodyDark } : {}
  return (
    <>
      {/* wheels */}
      <Box w={10} d={6} h={10} dx={dx - 18} dy={dy - 13} dz={dz} radius={3} {...tyre} />
      <Box w={10} d={6} h={10} dx={dx + 18} dy={dy - 13} dz={dz} radius={3} {...tyre} />
      <Box w={10} d={6} h={10} dx={dx - 18} dy={dy + 13} dz={dz} radius={3} {...tyre} />
      <Box w={10} d={6} h={10} dx={dx + 18} dy={dy + 13} dz={dz} radius={3} {...tyre} />
      {/* body + cabin */}
      <Box w={56} d={28} h={12} dx={dx} dy={dy} dz={dz + 5} radius={6} {...body} />
      <Box w={30} d={23} h={10} dx={dx - 3} dy={dy} dz={dz + 17} radius={5} glowTop={cabinGlow} {...body} />
      {/* headlight */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full"
        style={{
          width: '4px', height: '16px',
          marginLeft: `${dx + 26}px`, marginTop: `${dy - 8}px`,
          transform: `translateZ(${dz + 11}px)`,
          background: '#ffffff', boxShadow: '0 0 10px var(--lume-2)',
        }}
      />
    </>
  )
}

/* ── Service centre: workshop bays + a car up on the lift ───────────────── */
function ServiceCentreBody() {
  const bay = { bodyTop: '#0f172a', bodySide: '#111c30', bodyDark: '#0a1120' }
  return (
    <>
        {/* forecourt */}
        <Box w={214} d={214} h={8} dz={-8} radius={14} />

        {/* workshop block */}
        <Box w={150} d={104} h={62} dx={-16} dy={-22} dz={0} radius={6} windows />
        {/* roof + emissive sign band */}
        <Box w={166} d={120} h={10} dx={-16} dy={-22} dz={62} radius={8} glowTop />

        {/* three service bays cut into the front elevation */}
        {[-52, -8, 36].map((bx) => (
          <Box key={bx} w={34} d={7} h={40} dx={bx} dy={31} dz={0} radius={3} {...bay} />
        ))}

        {/* scissor lift with a car raised on it */}
        <Box w={14} d={14} h={30} dx={62} dy={54} dz={0} radius={3}
          bodyTop="#64748b" bodySide="#475569" bodyDark="#334155" />
        <Box w={74} d={44} h={7} dx={62} dy={54} dz={30} radius={5} glowTop />
        <MiniCar dx={62} dy={54} dz={37} />

        {/* tool chest + tyre stack */}
        <Box w={26} d={18} h={20} dx={-88} dy={62} dz={0} radius={4}
          bodyTop="#e2e8f0" bodySide="#cbd5e1" bodyDark="#94a3b8" />
        <Box w={22} d={22} h={8} dx={-52} dy={72} dz={0} radius={11}
          bodyTop="#334155" bodySide="#1e293b" bodyDark="#0f172a" />
        <Box w={22} d={22} h={8} dx={-52} dy={72} dz={8} radius={11}
          bodyTop="#334155" bodySide="#1e293b" bodyDark="#0f172a" />

        {/* rooftop AC units */}
        <Box w={14} d={14} h={8} dx={-52} dy={-48} dz={72} radius={3}
          bodyTop="#e2e8f0" bodySide="#cbd5e1" bodyDark="#94a3b8" />
        <Box w={10} d={10} h={6} dx={-4} dy={-12} dz={72} radius={3}
          bodyTop="#e2e8f0" bodySide="#cbd5e1" bodyDark="#94a3b8" />
    </>
  )
}

/* ── Showroom: glass pavilion with a car on the display plinth ──────────── */
function ShowroomBody() {
  const glass = {
    bodyTop: 'transparent',
    bodySide: 'color-mix(in srgb, var(--lume-2) 24%, transparent)',
    bodyDark: 'color-mix(in srgb, var(--lume-1) 18%, transparent)',
  }
  return (
    <>
        {/* forecourt */}
        <Box w={214} d={214} h={8} dz={-8} radius={14} />

        {/* display plinth + hero car, inside the glass */}
        <Box w={92} d={62} h={7} dz={0} radius={8} glowTop />
        <MiniCar dz={7} />

        {/* glass volume */}
        <Box w={152} d={128} h={70} dz={0} radius={4} {...glass} />

        {/* mullions */}
        {[-50, -16, 18, 52].map((mx) => (
          <span
            key={mx}
            aria-hidden
            className="absolute left-1/2 top-1/2 block"
            style={{
              width: '2px', height: '70px',
              marginLeft: `${mx}px`, marginTop: '62px',
              transformOrigin: 'top center',
              transform: 'rotateX(90deg)',
              background: 'var(--lume-2)', opacity: '0.55',
            }}
          />
        ))}

        {/* overhanging canopy */}
      <Box w={176} d={150} h={11} dz={70} radius={9} glowTop />
    </>
  )
}



/* ── Skyline: a small isometric city block ──────────────────────────────── */
const BUILDINGS = [
  { dx: -66, dy: -22, w: 46, d: 46, h: 128, glow: false },
  { dx: -14, dy: -60, w: 40, d: 40, h: 186, glow: true },
  { dx: 34,  dy: -18, w: 50, d: 50, h: 96,  glow: false },
  { dx: -30, dy: 34,  w: 44, d: 44, h: 152, glow: true },
  { dx: 30,  dy: 52,  w: 38, d: 38, h: 74,  glow: false },
  { dx: 78,  dy: 24,  w: 34, d: 34, h: 112, glow: false },
]

function CityBody() {
  return (
    <>
      <Box w={210} d={210} h={10} dz={-10} radius={12} />
      {BUILDINGS.map((b, i) => (
        <Box key={i} {...b} windows glowTop={b.glow} radius={4} />
      ))}

      {/* helipad on the tallest tower — the helicopter parks here between patrols */}
      <Box w={34} d={34} h={3} dx={-14} dy={-60} dz={186} radius={17}
        bodyTop="#e2e8f0" bodySide="#cbd5e1" bodyDark="#94a3b8" />
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 block rounded-full border-2"
        style={{
          width: '24px', height: '24px', marginLeft: '-26px', marginTop: '-72px',
          transform: 'translateZ(190px)',
          borderColor: 'var(--lume-2)', opacity: '0.65',
        }}
      />

      {/* antenna (second tower) + aviation beacons (CSS pulse; data-kia-motion so the
          global reduced-motion block kills the blink) */}
      <Box w={3} d={3} h={22} dx={-30} dy={34} dz={152} radius={1}
        bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" />
      {[
        { dx: -30, dy: 34, z: 178 },
        { dx: 78, dy: 24, z: 116 },
      ].map((b, i) => (
        <span
          key={i}
          aria-hidden
          data-kia-motion=""
          className="absolute left-1/2 top-1/2 block animate-pulse rounded-full"
          style={{
            width: '5px', height: '5px',
            marginLeft: `${b.dx - 2.5}px`, marginTop: `${b.dy - 2.5}px`,
            transform: `translateZ(${b.z}px)`,
            background: '#f43f5e', boxShadow: '0 0 10px rgba(244,63,94,.8)',
          }}
        />
      ))}
    </>
  )
}

/* ── Bottom-left cluster: a small companion assembly, gently breathing ───── */
/* ── PhysicsField ────────────────────────────────────────────────────────
   The background objects used to run on fixed `x: [from, to]` keyframes, so they slid straight
   through one another — collisions were impossible by construction. This replaces that with a real
   simulation: every body carries position + velocity, the loop integrates, resolves wall bounces and
   pairwise elastic collisions, and adds a scatter impulse + flash on every impact.

   Runs entirely outside React. Positions live in a ref and are written straight to node.style inside
   one rAF loop — 60fps of setState across 17 bodies would melt the page. */
type Body = {
  x: number; y: number
  vx: number; vy: number
  spin: number; spinV: number
  flash: number
  r: number
}

const SPEED_MIN = 16     // px/s — below this a body is nudged back up so nothing stalls
const SPEED_MAX = 78     // px/s — ceiling so a chain of impacts cannot fling anything off-screen
const RESTITUTION = 1.06 // slightly >1: impacts add a little energy, which reads as "scatter"

function PhysicsField() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([])
  const innerRefs = useRef<(HTMLDivElement | null)[]>([])
  const bodiesRef = useRef<Body[]>([])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    let W = wrap.clientWidth || 1200
    let H = wrap.clientHeight || 800

    // Deterministic seeding — golden-angle headings on a loose grid so nothing starts overlapped.
    const cols = 5
    const rows = Math.ceil(FIELD.length / cols)
    bodiesRef.current = FIELD.map((f, i) => {
      const cx = ((i % cols) + 0.5) / cols
      const cy = (Math.floor(i / cols) + 0.5) / rows
      const ang = i * 2.3999632
      const sp = 26 + (i % 5) * 9
      return {
        x: cx * W, y: cy * H,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        spin: (i * 37) % 360, spinV: ((i % 7) - 3) * 6,
        flash: 0, r: f.r,
      }
    })

    const ro = new ResizeObserver(() => {
      W = wrap.clientWidth || W
      H = wrap.clientHeight || H
    })
    ro.observe(wrap)

    if (!ENABLE_HOMEPAGE_ANIMATIONS) {
      // Write static initial layout for chips and do not start animation loop
      bodiesRef.current.forEach((b, i) => {
        const node = nodeRefs.current[i]
        if (node) {
          node.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, ${FIELD[i].depth}px)`
        }
        const inner = innerRefs.current[i]
        if (inner) {
          inner.style.transform = `perspective(680px) rotateX(56deg) rotateZ(-42deg)`
          inner.style.filter = 'none'
        }
      })
      return () => ro.disconnect()
    }

    let raf = 0
    let last = 0

    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      if (!last) { last = now; return }
      // Clamp dt: a backgrounded tab resumes with one enormous frame that would teleport every body.
      const dt = Math.min((now - last) / 1000, 0.032)
      last = now
      const B = bodiesRef.current

      for (const b of B) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.spin += b.spinV * dt
        b.flash *= 0.9

        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) }
        else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) }
        if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) }
        else if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy) }
      }

      // Pairwise collisions. 17 bodies is 136 checks per frame — cheap enough to brute force.
      for (let i = 0; i < B.length; i++) {
        for (let j = i + 1; j < B.length; j++) {
          const a = B[i]
          const c = B[j]
          const dx = c.x - a.x
          const dy = c.y - a.y
          const min = a.r + c.r
          const d2 = dx * dx + dy * dy
          if (d2 >= min * min || d2 === 0) continue

          const d = Math.sqrt(d2)
          const nx = dx / d
          const ny = dy / d

          // Separate them, or they re-collide every frame and stick together.
          const overlap = (min - d) / 2
          a.x -= nx * overlap; a.y -= ny * overlap
          c.x += nx * overlap; c.y += ny * overlap

          // Equal-mass elastic response along the contact normal.
          const rvn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny
          if (rvn >= 0) continue
          const imp = (-(1 + RESTITUTION) * rvn) / 2
          a.vx -= imp * nx; a.vy -= imp * ny
          c.vx += imp * nx; c.vy += imp * ny

          // Scatter: tangential kick + spin, so an impact reads as a knock, not a mirror bounce.
          const tx = -ny
          const ty = nx
          a.vx -= tx * 5; a.vy -= ty * 5
          c.vx += tx * 5; c.vy += ty * 5
          a.spinV += 24; c.spinV -= 24
          a.flash = 1; c.flash = 1
        }
      }

      for (let i = 0; i < B.length; i++) {
        const b = B[i]
        const sp = Math.hypot(b.vx, b.vy)
        if (sp > SPEED_MAX) { b.vx = (b.vx / sp) * SPEED_MAX; b.vy = (b.vy / sp) * SPEED_MAX }
        else if (sp < SPEED_MIN && sp > 0) { b.vx = (b.vx / sp) * SPEED_MIN; b.vy = (b.vy / sp) * SPEED_MIN }
        if (b.spinV > 90) b.spinV = 90
        if (b.spinV < -90) b.spinV = -90

        const node = nodeRefs.current[i]
        if (node) {
          node.style.transform =
            `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, ${FIELD[i].depth}px)`
        }
        const inner = innerRefs.current[i]
        if (inner) {
          const f = b.flash
          // perspective() FIRST in the list: the moving outer wrapper is transform-style:flat, so
          // without a local perspective the rotateX degenerates to an orthographic 2D skew and the
          // chip reads as a flattened sticker. Local (per-chip) perspective keeps the foreshortening
          // while leaving the collision sim's screen-space coordinates untouched.
          inner.style.transform =
            `perspective(680px) rotateX(56deg) rotateZ(-42deg) scale(${(1 + f * 0.16).toFixed(3)})`
          inner.style.filter = f > 0.02 ? `drop-shadow(0 0 ${(6 + f * 26).toFixed(0)}px var(--lume-halo))` : 'none'
        }
      }
    }

    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div ref={wrapRef} aria-hidden className="hub-scene pointer-events-none absolute inset-0 overflow-hidden">
      {FIELD.map((f, i) => (
        <div
          key={f.id}
          ref={(el) => { nodeRefs.current[i] = el }}
          className="absolute left-0 top-0"
          style={{ willChange: 'transform' }}
        >
          <div
            ref={(el) => { innerRefs.current[i] = el }}
            className="hub-3d grid place-items-center"
            style={{ width: `${f.r * 2}px`, height: `${f.r * 2}px` }}
          >
            <FieldSprite item={f} />
          </div>
        </div>
      ))}
    </div>
  )
}

function FieldSprite({ item }: { item: FieldItem }) {
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-[12px] border px-3.5 py-2"
      style={{
        backgroundColor: item.em
          ? 'color-mix(in srgb, var(--lume-2) 14%, var(--kia-surface))'
          : 'color-mix(in srgb, var(--kia-surface) 92%, var(--lume-2))',
        borderColor: 'var(--hub-line)',
        // Layered shadows sell the thickness the tilt alone can't: a bright top-edge inset (lit
        // face), a hard 2px bottom edge (the card's side), and a soft drop onto the canvas.
        boxShadow: item.em
          ? 'inset 0 1px 0 rgba(255,255,255,.8), 0 2px 0 color-mix(in srgb, var(--lume-1) 22%, #ffffff), 0 10px 26px -12px var(--lume-halo), 0 6px 12px rgba(15,23,42,.10)'
          : 'inset 0 1px 0 rgba(255,255,255,.7), 0 2px 0 color-mix(in srgb, var(--lume-1) 14%, #ffffff), 0 6px 12px rgba(15,23,42,.08)',
        opacity: item.em ? '0.72' : '0.5',
      }}
    >
      <span
        className="block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: 'var(--lume-2)', boxShadow: '0 0 8px var(--lume-halo)' }}
      />
      <span
        className="text-[13px] font-bold tracking-tight"
        style={{ color: item.em ? 'var(--lume-2)' : 'var(--kia-text-soft)' }}
      >
        {item.label}
      </span>
    </span>
  )
}
