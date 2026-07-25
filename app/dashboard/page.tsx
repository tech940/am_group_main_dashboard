'use client'

import React, { useState, useRef, useCallback, useSyncExternalStore } from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'motion/react'
import { MainLayout } from '@/components/layout/main-layout'
import { Zap } from 'lucide-react'

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


// Shapes that travel across the full width, continuously.
const TRAVELERS = [
  { id: 0, kind: 'cube',  top: '14%', size: 46, dur: 30, delay: 0,   depth: -220, dir: 1 },
  { id: 1, kind: 'ring',  top: '62%', size: 62, dur: 44, delay: 6,   depth: -340, dir: -1 },
  { id: 2, kind: 'orb',   top: '34%', size: 30, dur: 36, delay: 12,  depth: -160, dir: 1 },
  { id: 3, kind: 'cube',  top: '78%', size: 34, dur: 52, delay: 3,   depth: -420, dir: -1 },
  { id: 4, kind: 'pyr',   top: '24%', size: 40, dur: 40, delay: 18,  depth: -280, dir: 1 },
  { id: 5, kind: 'orb',   top: '86%', size: 22, dur: 34, delay: 24,  depth: -200, dir: -1 },
] as const

// Capability words that drift across the scene as small isometric chips. Staggered lanes, mixed
// directions and non-harmonic durations so they never sync up or clump.
const TEXT_TRAVELERS = [
  { id: 0, label: 'CRM',           top: '8%',  dur: 46, delay: 0,  depth: -180, dir: 1,  em: true },
  { id: 1, label: 'Growth',        top: '20%', dur: 62, delay: 9,  depth: -300, dir: -1, em: false },
  { id: 2, label: 'Bookings',      top: '31%', dur: 54, delay: 20, depth: -240, dir: 1,  em: false },
  { id: 3, label: 'Analytics',     top: '44%', dur: 70, delay: 5,  depth: -360, dir: -1, em: true },
  { id: 4, label: 'Inventory',     top: '55%', dur: 50, delay: 30, depth: -200, dir: 1,  em: false },
  { id: 5, label: 'Workshop',      top: '66%', dur: 66, delay: 14, depth: -320, dir: -1, em: false },
  { id: 6, label: 'Finance',       top: '76%', dur: 44, delay: 26, depth: -160, dir: 1,  em: true },
  { id: 7, label: 'Real-time data', top: '88%', dur: 74, delay: 2,  depth: -400, dir: -1, em: false },
  { id: 8, label: 'Multi-brand',   top: '14%', dur: 58, delay: 34, depth: -280, dir: -1, em: false },
  { id: 9, label: 'Service',       top: '60%', dur: 48, delay: 41, depth: -220, dir: 1,  em: false },
  { id: 10, label: 'Automation',   top: '38%', dur: 68, delay: 47, depth: -340, dir: 1,  em: false },
  { id: 11, label: 'Insights',     top: '82%', dur: 56, delay: 17, depth: -260, dir: -1, em: true },
] as const

// Deterministic scatter — pre-rounded, unit-bearing strings (see hydration note above).
const PARTICLES = Array.from({ length: 30 }, (_, i) => {
  const a = (i * 137.508) % 360
  const r = 10 + ((i * 41) % 88)
  const size = 2 + (i % 3)
  return {
    id: i,
    left: `${(50 + Math.cos((a * Math.PI) / 180) * r * 0.62).toFixed(3)}%`,
    top: `${(50 + Math.sin((a * Math.PI) / 180) * r * 0.5).toFixed(3)}%`,
    size: `${size}px`,
    delay: (i % 11) * 0.4,
    dur: 6 + (i % 6),
  }
})

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
`

export default function DashboardPortal() {
  const reduce = useReducedMotion()
  const isClient = useSyncExternalStore(NEVER_CHANGES, onClient, onServer)
  const animated = !reduce
  const decor = animated && isClient

  const [active, setActive] = useState<string | null>(null)

  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 70, damping: 20, mass: 0.7 })
  const sy = useSpring(my, { stiffness: 70, damping: 20, mass: 0.7 })
  const rotZ = useTransform(sx, [-0.5, 0.5], [-52, -38])
  const rotX = useTransform(sy, [-0.5, 0.5], [64, 52])
  const sceneRef = useRef<HTMLDivElement>(null)

  const onMove = useCallback((e: React.PointerEvent) => {
    if (reduce) return
    const el = sceneRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }, [mx, my, reduce])

  const onLeave = useCallback(() => { mx.set(0); my.set(0) }, [mx, my])

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
          {/* ── Ambient ─────────────────────────────────────────────────── */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -left-32 top-0 h-[480px] w-[480px] rounded-full"
            style={{ background: 'radial-gradient(circle, var(--hub-glow), transparent 68%)', filter: 'blur(50px)', opacity: 0.4 }}
            animate={animated ? { x: [0, 30, 0], y: [0, 24, 0] } : undefined}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -right-36 bottom-0 h-[440px] w-[440px] rounded-full"
            style={{ background: 'radial-gradient(circle, var(--hub-glow), transparent 70%)', filter: 'blur(56px)', opacity: 0.32 }}
            animate={animated ? { x: [0, -28, 0], y: [0, -22, 0] } : undefined}
            transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
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

          {/* ── Shapes travelling across the screen, continuously ────────── */}
          {decor && (
            <div aria-hidden className="hub-scene pointer-events-none absolute inset-0">
              {TRAVELERS.map((t) => (
                <Traveler key={t.id} {...t} />
              ))}
            </div>
          )}

          {/* ── Capability words drifting across, same idea as the shapes ── */}
          {decor && (
            <div aria-hidden className="hub-scene pointer-events-none absolute inset-0">
              {TEXT_TRAVELERS.map((t) => (
                <TravelingChip key={t.id} {...t} />
              ))}
            </div>
          )}

          {/* Particles */}
          {decor && (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {PARTICLES.map((p) => (
                <motion.span
                  key={p.id}
                  className="absolute rounded-full"
                  style={{
                    left: p.left, top: p.top, width: p.size, height: p.size,
                    backgroundColor: 'var(--hub-accent)',
                    boxShadow: '0 0 10px var(--hub-glow)',
                  }}
                  animate={{ y: [0, -20, 0], opacity: [0.12, 0.55, 0.12] }}
                  transition={{ duration: p.dur, repeat: Infinity, ease: 'easeInOut', delay: p.delay }}
                />
              ))}
            </div>
          )}

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
              <Zap className="h-3 w-3" /> AM Group Operating System
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
              Sales, service, inventory and finance — unified across KIA, Hyundai and Platinum.
              Move your cursor to rotate the stack.
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
                <Campus active={active} setActive={setActive} decor={decor} />
              </motion.div>
            </div>
          </div>

          {/* ── Featured vehicle, anchored to the copy column ──────────────── */}
          <div className="pointer-events-none absolute left-[2%] top-[46%] hidden xl:block">
            <CarModel animated={animated} />
          </div>

          {/* Mobile / tablet: the yard alone — the full campus is unreadable this small */}
          <div className="relative z-10 mt-6 flex justify-center pb-8 lg:hidden">
            <div className="hub-3d relative h-[360px] w-[320px]" style={{ transform: 'rotateX(58deg) rotateZ(-45deg) scale(0.58)' }}>
              <StockYard active={active} setActive={setActive} decor={decor} />
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}

/* ── client-only gate (lint-clean; no setState in an effect) ─────────────── */
const NEVER_CHANGES = () => () => {}
const onClient = () => true
const onServer = () => false

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

function Campus({ active, setActive, decor }: {
  active: string | null; setActive: (v: string | null) => void; decor: boolean
}) {
  return (
    <>
      {/* the single shared ground everything stands on */}
      <Box w={920} d={920} h={16} dx={-40} dy={-70} dz={-34} radius={48} />

      {/* service roads linking the plots to the yard */}
      <Road dx={-90} dy={186} w={150} d={40} />
      <Road dx={-90} dy={-150} w={150} d={40} />

      <Plot {...PLOTS.city}><CityBody /></Plot>

      <Plot {...PLOTS.service}><ServiceCentreBody /></Plot>
      <PlotLabel dx={PLOTS.service.dx} dy={PLOTS.service.dy + 132}>Service Centre</PlotLabel>

      <Plot {...PLOTS.showroom}><ShowroomBody /></Plot>
      <PlotLabel dx={PLOTS.showroom.dx} dy={PLOTS.showroom.dy + 132}>Showroom</PlotLabel>

      <Plot {...PLOTS.yard}>
        <StockYard active={active} setActive={setActive} decor={decor} />
      </Plot>
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

function StockYard({ active, setActive, decor }: {
  active: string | null; setActive: (v: string | null) => void; decor: boolean
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
        return (
          <div key={row.label} className="hub-3d">
            {YARD_COLS.map((dx) => (
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
        </div>
      ))}

      {/* entrance pylon with its light beam */}
      <Box w={26} d={26} h={128} dx={0} dy={-232} dz={0} radius={5} />
      <Box w={44} d={44} h={16} dx={0} dy={-232} dz={128} radius={6} glowTop />
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
function MiniCar({ dx = 0, dy = 0, dz = 0 }: { dx?: number; dy?: number; dz?: number }) {
  const tyre = { bodyTop: '#475569', bodySide: '#1e293b', bodyDark: '#0f172a' }
  return (
    <>
      {/* wheels */}
      <Box w={10} d={6} h={10} dx={dx - 18} dy={dy - 13} dz={dz} radius={3} {...tyre} />
      <Box w={10} d={6} h={10} dx={dx + 18} dy={dy - 13} dz={dz} radius={3} {...tyre} />
      <Box w={10} d={6} h={10} dx={dx - 18} dy={dy + 13} dz={dz} radius={3} {...tyre} />
      <Box w={10} d={6} h={10} dx={dx + 18} dy={dy + 13} dz={dz} radius={3} {...tyre} />
      {/* body + cabin */}
      <Box w={56} d={28} h={12} dx={dx} dy={dy} dz={dz + 5} radius={6} />
      <Box w={30} d={23} h={10} dx={dx - 3} dy={dy} dz={dz + 17} radius={5} glowTop />
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
    </>
  )
}

/* ── Holographic car ─────────────────────────────────────────────────────
   Stacked boxes can't make a car read as a car. This is an SVG sedan profile drawn as a glowing
   wireframe — a projection standing upright above an isometric turntable, which is exactly how the
   reference reads: hologram on a lit plinth, not a solid model.                                   */
function CarModel({ animated }: { animated: boolean }) {
  const stroke = 'var(--lume-2)'
  return (
    <motion.div
      className="relative"
      animate={animated ? { y: [0, -10, 0] } : undefined}
      transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* No plinth: the isometric turntable that used to sit under this projection extended down
          into the skyline below and read as a stray white circle on top of the buildings. The car
          now floats on its own under-glow, which also keeps the two elements from colliding. */}

      {/* the projection */}
      <svg
        viewBox="0 0 420 190"
        className="relative block w-[280px]"
        style={{ filter: 'drop-shadow(0 0 10px var(--lume-halo))' }}
        aria-hidden
      >
        <defs>
          <linearGradient id="carGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--lume-2)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--lume-1)" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--lume-2)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--lume-1)" stopOpacity="0.04" />
          </linearGradient>
          <radialGradient id="carUnder">
            <stop offset="0%" stopColor="var(--lume-2)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--lume-2)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* under-glow */}
        <ellipse cx="210" cy="150" rx="180" ry="16" fill="url(#carUnder)" />

        {/* body */}
        <motion.path
          d="M 26 140 C 16 139 10 131 13 121 C 16 111 27 105 41 102 L 88 94
             C 108 75 133 61 163 54 C 197 46 247 46 281 54 C 309 60 333 73 353 89
             L 389 99 C 403 104 409 113 406 124 C 403 134 395 140 385 140 Z"
          fill="url(#carBody)" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round"
          initial={animated ? { pathLength: 0, opacity: 0 } : false}
          animate={animated ? { pathLength: 1, opacity: 1 } : false}
          transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
        />

        {/* greenhouse / glass */}
        <motion.path
          d="M 120 92 C 140 71 162 59 188 54 C 221 48 252 50 278 57 C 300 63 318 75 330 90 Z"
          fill="url(#carGlass)" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round"
          initial={animated ? { pathLength: 0 } : false}
          animate={animated ? { pathLength: 1 } : false}
          transition={{ duration: 1.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        />
        {/* B-pillar + door cut + shoulder crease */}
        <path d="M 216 50 L 216 92" stroke={stroke} strokeWidth="1.4" opacity="0.75" />
        <path d="M 216 92 L 214 128" stroke={stroke} strokeWidth="1.2" opacity="0.5" />
        <path d="M 96 112 L 330 108" stroke={stroke} strokeWidth="1.2" opacity="0.45" />

        {/* wheels */}
        {[112, 322].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="140" r="31" fill="none" stroke={stroke} strokeWidth="2.2" />
            <circle cx={cx} cy="140" r="17" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.7" />
            <circle cx={cx} cy="140" r="5" fill={stroke} opacity="0.85" />
          </g>
        ))}

        {/* headlight (front, right) + taillight (rear, left) */}
        <ellipse cx="396" cy="112" rx="11" ry="5" fill="#ffffff" opacity="0.95" />
        <ellipse cx="396" cy="112" rx="22" ry="10" fill="var(--lume-2)" opacity="0.3" />
        <ellipse cx="22" cy="120" rx="8" ry="4" fill="#f43f5e" opacity="0.85" />

        {/* holographic scan line */}
        {animated && (
          <motion.rect
            x="0" width="420" height="2.5" fill="var(--lume-edge)" opacity="0.55"
            animate={{ y: [40, 148, 40] }}
            transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </svg>
    </motion.div>
  )
}

/* ── A capability word drifting across the scene as a small isometric block ─ */
function TravelingChip({ label, top, dur, delay, depth, dir, em }: {
  label: string; top: string; dur: number; delay: number; depth: number; dir: number; em: boolean
}) {
  const from = dir > 0 ? '-22vw' : '112vw'
  const to = dir > 0 ? '112vw' : '-22vw'
  return (
    <motion.div
      className="absolute"
      style={{ top, left: '0px', transform: `translateZ(${depth}px)` }}
      initial={{ x: from }}
      animate={{ x: [from, to], y: [0, -14, 0, 14, 0] }}
      transition={{
        x: { duration: dur, repeat: Infinity, ease: 'linear', delay },
        y: { duration: dur / 5, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {/* Tilted into the same isometric plane as the slabs so the words read as part of the scene
          rather than as UI floating on top of it. */}
      <span
        className="inline-flex items-center gap-2 rounded-[12px] border px-3.5 py-2 whitespace-nowrap"
        style={{
          transform: 'rotateX(56deg) rotateZ(-42deg)',
          backgroundColor: em
            ? 'color-mix(in srgb, var(--hub-accent) 14%, var(--kia-surface))'
            : 'color-mix(in srgb, var(--kia-surface) 92%, var(--hub-accent))',
          borderColor: 'var(--hub-line)',
          boxShadow: em ? '0 10px 26px -12px var(--hub-glow)' : 'none',
          opacity: em ? '0.62' : '0.42',
        }}
      >
        <span
          className="block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: 'var(--hub-accent)', boxShadow: '0 0 8px var(--hub-glow)' }}
        />
        <span
          className="text-[13px] font-bold tracking-tight"
          style={{ color: em ? 'var(--hub-accent)' : 'var(--kia-text-soft)' }}
        >
          {label}
        </span>
      </span>
    </motion.div>
  )
}

/* ── Bottom-left cluster: a small companion assembly, gently breathing ───── */
/* ── A shape that travels across the whole screen, forever ───────────────── */
function Traveler({ kind, top, size, dur, delay, depth, dir }: {
  kind: 'cube' | 'ring' | 'orb' | 'pyr'
  top: string; size: number; dur: number; delay: number; depth: number; dir: number
}) {
  const from = dir > 0 ? '-14vw' : '114vw'
  const to = dir > 0 ? '114vw' : '-14vw'
  return (
    <motion.div
      className="hub-3d absolute"
      style={{ top, left: '0px', width: `${size}px`, height: `${size}px`, transform: `translateZ(${depth}px)` }}
      initial={{ x: from }}
      animate={{ x: [from, to], y: [0, -18, 0, 18, 0] }}
      transition={{
        x: { duration: dur, repeat: Infinity, ease: 'linear', delay },
        y: { duration: dur / 4, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      <motion.div
        className="hub-3d h-full w-full"
        animate={{ rotateX: [0, 360], rotateY: [0, 360] }}
        transition={{
          rotateX: { duration: 18 + size % 7, repeat: Infinity, ease: 'linear' },
          rotateY: { duration: 24 + size % 5, repeat: Infinity, ease: 'linear' },
        }}
      >
        {kind === 'cube' && <MiniCube size={size} />}
        {kind === 'ring' && (
          <span
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: 'var(--lume-2)', opacity: '0.6', boxShadow: '0 0 22px var(--lume-halo)' }}
          />
        )}
        {kind === 'orb' && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle at 32% 28%, #ffffff, var(--lume-2) 46%, var(--lume-1) 72%, transparent 76%)',
              boxShadow: '0 0 26px var(--hub-glow)', opacity: '0.75',
            }}
          />
        )}
        {kind === 'pyr' && (
          <span
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(160deg, var(--hub-accent), transparent 70%)',
              clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
              opacity: '0.42', filter: 'drop-shadow(0 0 12px var(--hub-glow))',
            }}
          />
        )}
      </motion.div>
    </motion.div>
  )
}

function MiniCube({ size }: { size: number }) {
  const t = size / 2
  const faces = [
    `rotateY(0deg) translateZ(${t}px)`, `rotateY(90deg) translateZ(${t}px)`,
    `rotateY(180deg) translateZ(${t}px)`, `rotateY(-90deg) translateZ(${t}px)`,
    `rotateX(90deg) translateZ(${t}px)`, `rotateX(-90deg) translateZ(${t}px)`,
  ]
  return (
    <>
      {faces.map((tr, i) => (
        <span
          key={i}
          className="absolute inset-0 rounded-[8px] border"
          style={{
            transform: tr,
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--lume-1) 26%, transparent), color-mix(in srgb, var(--lume-2) 22%, transparent))',
            borderColor: 'var(--lume-edge)',
            boxShadow: 'inset 0 0 18px var(--lume-halo), 0 0 14px var(--lume-halo)',
          }}
        />
      ))}
    </>
  )
}
