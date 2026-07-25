'use client'

import React, { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
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


// Background field. Each entry becomes a rigid body in the collision simulation below.
// `r` is the collision radius: half the sprite for shapes, an estimate from label width for chips.
const FIELD: FieldItem[] = [
  { id: 0,  kind: 'cube', size: 46, r: 25, depth: -220 },
  { id: 1,  kind: 'ring', size: 62, r: 32, depth: -340 },
  { id: 2,  kind: 'orb',  size: 30, r: 16, depth: -160 },
  { id: 3,  kind: 'cube', size: 34, r: 19, depth: -420 },
  { id: 4,  kind: 'pyr',  size: 40, r: 21, depth: -280 },
  { id: 5,  kind: 'orb',  size: 22, r: 12, depth: -200 },
  { id: 6,  kind: 'cube', size: 28, r: 16, depth: -300 },
  { id: 7,  kind: 'chip', label: 'CRM',            em: true,  r: 40, depth: -180 },
  { id: 8,  kind: 'chip', label: 'Growth',         em: false, r: 46, depth: -300 },
  { id: 9,  kind: 'chip', label: 'Bookings',       em: false, r: 50, depth: -240 },
  { id: 10, kind: 'chip', label: 'Analytics',      em: true,  r: 51, depth: -360 },
  { id: 11, kind: 'chip', label: 'Inventory',      em: false, r: 51, depth: -200 },
  { id: 12, kind: 'chip', label: 'Workshop',       em: false, r: 50, depth: -320 },
  { id: 13, kind: 'chip', label: 'Finance',        em: true,  r: 46, depth: -160 },
  { id: 14, kind: 'chip', label: 'Real-time data', em: false, r: 60, depth: -400 },
  { id: 15, kind: 'chip', label: 'Multi-brand',    em: false, r: 55, depth: -280 },
  { id: 16, kind: 'chip', label: 'Automation',     em: false, r: 54, depth: -340 },
]

type FieldItem = {
  id: number
  kind: 'cube' | 'ring' | 'orb' | 'pyr' | 'chip'
  r: number
  depth: number
  size?: number
  label?: string
  em?: boolean
}

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

          {/* ── Background field: real collision physics, not fixed paths ─── */}
          {decor && <PhysicsField />}

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

/* ── ServiceLoop: a car drives in, waits at the bay, gets serviced, leaves renewed ──
   One 13s keyframe timeline shared by every element (car path, flash, sparks, status chip), so the
   choreography can never drift apart. The path runs along campus y=-128 — chosen against every
   plot footprint: it skims the empty top strip of the yard pad, clears the entrance pylon (ends at
   y≈-149) and the service road, then swings into the middle bay at (-276, -104).

   The "before" car is dull grey; at the flash peak it steps to the glowing "after" car. The swap is
   a STEP (duplicated keyframe times), not a fade — animated opacity between 0 and 1 forces
   transform-style to flat mid-fade, which would squash the 3D boxes; at rest values of exactly 0/1
   preserve-3d is unaffected, and the white flash covers the single transition frame.            */
const LOOP_T = 13
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
        initial={false}
        animate={{ x: LOOP_X, y: LOOP_Y, rotateZ: LOOP_ROT }}
        transition={{ ...loop, times: LOOP_TIMES }}
      >
        {/* before: dull grey, no cabin glow */}
        <motion.div
          className="hub-3d"
          initial={false}
          animate={{ opacity: [1, 1, 0, 0] }}
          transition={{ ...loop, times: [0, 0.44, 0.45, 1] }}
        >
          <MiniCar bodyTop="#94a3b8" bodySide="#64748b" bodyDark="#475569" cabinGlow={false} />
        </motion.div>
        {/* after: factory-fresh, glowing cabin + under-halo */}
        <motion.div
          className="hub-3d"
          initial={false}
          animate={{ opacity: [0, 0, 1, 1] }}
          transition={{ ...loop, times: [0, 0.44, 0.45, 1] }}
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
const TRUCK_T = 16
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
        initial={false}
        animate={{ x: TRUCK_X, y: [-80, -80, -80, -80, -80] }}
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

      {/* the cargo: rides the flatbed in perfect sync, then slides off into the slot */}
      <motion.div
        aria-hidden
        className="hub-3d absolute left-1/2 top-1/2 h-0 w-0"
        initial={false}
        animate={{ x: CARGO_X, y: CARGO_Y, z: CARGO_Z, opacity: [1, 1, 1, 1, 1, 0, 0] }}
        transition={{
          ...loop,
          x: { ...loop, times: CARGO_TIMES },
          y: { ...loop, times: CARGO_TIMES },
          z: { ...loop, times: CARGO_TIMES },
          opacity: { ...loop, times: [0, 0.25, 0.3, 0.4, 0.85, 0.855, 1] },
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
        <StockYard active={active} setActive={setActive} decor={decor} delivery={decor} />
      </Plot>

      {/* the animated service visit — a car drives in, waits, gets serviced, leaves renewed */}
      {decor && <ServiceLoop />}

      {/* the transporter bringing new stock to the yard */}
      {decor && <NewStockDelivery />}
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

function StockYard({ active, setActive, decor, delivery }: {
  active: string | null; setActive: (v: string | null) => void; decor: boolean
  // When the delivery loop is running, the first New Stock slot is left empty for it to fill —
  // the animated delivered car occupies exactly that position. Mobile (no campus, no loop)
  // omits the prop and renders the full row.
  delivery?: boolean
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
        // The first New Stock slot (dx -140 → campus x=30) is the delivery loop's drop target.
        const cols = delivery && row.label === 'New Stock'
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
          inner.style.transform =
            FIELD[i].kind === 'chip'
              ? `rotateX(56deg) rotateZ(-42deg) scale(${(1 + f * 0.16).toFixed(3)})`
              : `rotateX(${b.spin.toFixed(1)}deg) rotateY(${(b.spin * 1.3).toFixed(1)}deg) scale(${(1 + f * 0.3).toFixed(3)})`
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
  if (item.kind === 'chip') {
    return (
      <span
        className="inline-flex items-center gap-2 whitespace-nowrap rounded-[12px] border px-3.5 py-2"
        style={{
          backgroundColor: item.em
            ? 'color-mix(in srgb, var(--lume-2) 14%, var(--kia-surface))'
            : 'color-mix(in srgb, var(--kia-surface) 92%, var(--lume-2))',
          borderColor: 'var(--hub-line)',
          boxShadow: item.em ? '0 10px 26px -12px var(--lume-halo)' : 'none',
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

  const size = item.size || 32

  if (item.kind === 'cube') {
    return (
      <div className="hub-3d relative" style={{ width: `${size}px`, height: `${size}px` }}>
        <MiniCube size={size} />
      </div>
    )
  }

  if (item.kind === 'ring') {
    return (
      <span
        className="block rounded-full border-2"
        style={{
          width: `${size}px`, height: `${size}px`,
          borderColor: 'var(--lume-2)', opacity: '0.6',
          boxShadow: '0 0 22px var(--lume-halo)',
        }}
      />
    )
  }

  if (item.kind === 'orb') {
    return (
      <span
        className="block rounded-full"
        style={{
          width: `${size}px`, height: `${size}px`,
          background: 'radial-gradient(circle at 32% 28%, #ffffff, var(--lume-2) 46%, var(--lume-1) 72%, transparent 76%)',
          boxShadow: '0 0 26px var(--lume-halo)', opacity: '0.8',
        }}
      />
    )
  }

  return (
    <span
      className="block"
      style={{
        width: `${size}px`, height: `${size}px`,
        background: 'linear-gradient(160deg, var(--lume-2), transparent 70%)',
        clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
        opacity: '0.5', filter: 'drop-shadow(0 0 12px var(--lume-halo))',
      }}
    />
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
