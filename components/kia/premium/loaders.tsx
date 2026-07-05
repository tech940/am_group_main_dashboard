'use client'

/**
 * Contextual automotive loaders.
 *
 * Every important workflow gets a loader that *narrates* the operation instead
 * of a generic spinner — a car being reserved, a VIN card locking into place,
 * an invoice being verified, a proforma being stamped, a car driving out for
 * delivery. Each scene is a self-contained animated SVG driven by Framer Motion
 * and coloured from the active accent token, so it matches every theme.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion, usePremiumMotion } from './motion'

export type LoaderVariant =
  | 'generic'
  | 'reserve'
  | 'allocate'
  | 'vin-match'
  | 'payment'
  | 'proforma'
  | 'approval'
  | 'delivery'
  | 'transfer'
  | 'search'

const LOOP = { repeat: Infinity, ease: 'easeInOut' as const }
const LINEAR = { repeat: Infinity, ease: 'linear' as const }

/* ------------------------------------------------------------- primitives */

function Wheel({ cx, cy, r = 5.2, spin = true, dur = 0.8 }: { cx: number; cy: number; r?: number; spin?: boolean; dur?: number }) {
  const animated = usePremiumMotion()
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="var(--kia-surface, #fff)" stroke="currentColor" strokeWidth={2.2} />
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        animate={animated && spin ? { rotate: 360 } : undefined}
        transition={{ ...LINEAR, duration: dur }}
      >
        <circle cx={cx} cy={cy} r={r * 0.32} fill="currentColor" />
        <line x1={cx} y1={cy - r * 0.66} x2={cx} y2={cy + r * 0.66} stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
        <line x1={cx - r * 0.66} y1={cy} x2={cx + r * 0.66} y2={cy} stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
      </motion.g>
    </g>
  )
}

const CAR_BODY =
  'M6 27 C6 24 8 23 11 22.5 L14 22.5 C15.5 16 20 13 27 13 L44 13 C49 13 52.5 15.5 56 20 L61 21 C64 21.5 66 23 66 26 L66 28 C66 29 65 29.6 64 29.6 L8 29.6 C6.6 29.6 6 28.9 6 27 Z'

function CarGlyph({ spin = false, wheelDur = 0.8 }: { spin?: boolean; wheelDur?: number }) {
  return (
    <g>
      <path d={CAR_BODY} fill="color-mix(in srgb, currentColor 14%, transparent)" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" />
      {/* windows */}
      <path d="M18.5 22 C19.6 17.6 22.4 15.4 27 15.4 L34 15.4 L34 22 Z" fill="color-mix(in srgb, currentColor 26%, transparent)" />
      <path d="M36 15.4 L43.5 15.4 C47 15.4 49.6 17.2 52 21.2 L52 22 L36 22 Z" fill="color-mix(in srgb, currentColor 26%, transparent)" />
      {/* headlight */}
      <circle cx={63} cy={24.5} r={1.3} fill="currentColor" />
      <Wheel cx={22} cy={30} spin={spin} dur={wheelDur} />
      <Wheel cx={52} cy={30} spin={spin} dur={wheelDur} />
    </g>
  )
}

function Road({ y = 36 }: { y?: number }) {
  return <div className="kia-anim-road absolute inset-x-3 h-[3px]" style={{ top: `${(y / 40) * 100}%`, color: 'inherit' }} />
}

function PulseRing({ cx, cy, r = 10, delay = 0 }: { cx: number; cy: number; r?: number; delay?: number }) {
  const animated = usePremiumMotion()
  if (!animated) return null
  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      initial={{ scale: 0.6, opacity: 0.7 }}
      animate={{ scale: 1.8, opacity: 0 }}
      transition={{ ...LOOP, duration: 1.8, delay, ease: 'easeOut' }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    />
  )
}

/* ---------------------------------------------------------------- scenes */

function SvgScene({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 72 40" className="h-full w-full overflow-visible" style={{ color: 'inherit' }}>
      {children}
    </svg>
  )
}

function SceneGeneric() {
  const animated = usePremiumMotion()
  return (
    <SvgScene>
      <circle cx={36} cy={22} r={15} fill="none" stroke="color-mix(in srgb, currentColor 16%, transparent)" strokeWidth={3} />
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        animate={animated ? { rotate: 360 } : undefined}
        transition={{ ...LINEAR, duration: 1.1 }}
      >
        <path d="M36 7 A15 15 0 0 1 51 22" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      </motion.g>
      <motion.g animate={animated ? { y: [-1.5, 1.5, -1.5] } : undefined} transition={{ ...LOOP, duration: 2 }}>
        <g transform="translate(18 6) scale(0.5)">
          <CarGlyph />
        </g>
      </motion.g>
    </SvgScene>
  )
}

function SceneReserve() {
  return (
    <SvgScene>
      <PulseRing cx={36} cy={21} r={12} />
      <PulseRing cx={36} cy={21} r={12} delay={0.9} />
      <CarGlyph />
      <motion.g
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...LOOP, duration: 1.6, repeatType: 'reverse' }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        <circle cx={57} cy={12} r={5} fill="var(--kia-surface,#fff)" stroke="currentColor" strokeWidth={2} />
        <path d="M55 12 l1.4 1.6 L59.4 10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </SvgScene>
  )
}

function SceneAllocate() {
  const animated = usePremiumMotion()
  return (
    <SvgScene>
      {/* stock stack */}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={5} y={12 + i * 6} width={13} height={4.4} rx={1.4} fill="color-mix(in srgb, currentColor 18%, transparent)" />
      ))}
      {/* reservation slot */}
      <rect x={50} y={17} width={17} height={9} rx={2.4} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="3 3" opacity={0.6} />
      {/* travelling unit */}
      <motion.rect
        x={0}
        y={0}
        width={15}
        height={6}
        rx={1.8}
        fill="currentColor"
        initial={{ x: 6, y: 18, opacity: 0 }}
        animate={animated ? { x: [6, 51], y: [18, 18.5], opacity: [0, 1, 1, 0] } : { x: 51, y: 18, opacity: 1 }}
        transition={{ ...LOOP, duration: 1.9, times: [0, 0.2, 0.8, 1] }}
      />
    </SvgScene>
  )
}

function SceneVinMatch() {
  const animated = usePremiumMotion()
  const card = (from: number, delay: number) => (
    <motion.g
      initial={{ y: from, opacity: 0 }}
      animate={animated ? { y: [from, 0, 0, from], opacity: [0, 1, 1, 0] } : { y: 0, opacity: 1 }}
      transition={{ ...LOOP, duration: 2.2, times: [0, 0.35, 0.72, 1], delay }}
    >
      <rect x={20} y={from > 0 ? 24 : 10} width={32} height={6} rx={1.8} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <rect x={22.5} y={from > 0 ? 26 : 12} width={16} height={2} rx={1} fill="currentColor" opacity={0.7} />
    </motion.g>
  )
  return (
    <SvgScene>
      {card(-9, 0)}
      {card(9, 0.15)}
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={animated ? { scale: [0, 0, 1, 1, 0], opacity: [0, 0, 1, 1, 0] } : { scale: 1, opacity: 1 }}
        transition={{ ...LOOP, duration: 2.2, times: [0, 0.4, 0.55, 0.75, 1] }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        <circle cx={36} cy={20} r={5.4} fill="currentColor" />
        <path d="M33.4 20 l1.7 1.8 L38.8 17.6" fill="none" stroke="var(--kia-surface,#fff)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </SvgScene>
  )
}

function ScenePayment() {
  const animated = usePremiumMotion()
  return (
    <SvgScene>
      {/* invoice */}
      <rect x={10} y={9} width={26} height={24} rx={2.6} fill="var(--kia-surface,#fff)" stroke="currentColor" strokeWidth={1.8} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={13.5} y={13.5 + i * 4.4} width={i === 3 ? 10 : 19} height={1.8} rx={0.9} fill="currentColor" opacity={0.55} />
      ))}
      {/* flipping rupee coin */}
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        animate={animated ? { rotateY: 360, y: [-1, 1, -1] } : undefined}
        transition={{ rotateY: { ...LINEAR, duration: 1.4 }, y: { ...LOOP, duration: 1.6 } }}
      >
        <circle cx={52} cy={21} r={8} fill="color-mix(in srgb, currentColor 16%, transparent)" stroke="currentColor" strokeWidth={2} />
        <text x={52} y={25} textAnchor="middle" fontSize="10" fontWeight="800" fill="currentColor">₹</text>
      </motion.g>
    </SvgScene>
  )
}

function SceneStamp({ approval = false }: { approval?: boolean }) {
  const animated = usePremiumMotion()
  return (
    <SvgScene>
      <rect x={16} y={7} width={30} height={28} rx={3} fill="var(--kia-surface,#fff)" stroke="currentColor" strokeWidth={1.8} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={20} y={12 + i * 4.6} width={i === 3 ? 12 : 22} height={1.8} rx={0.9} fill="currentColor" opacity={0.5} />
      ))}
      <PulseRing cx={40} cy={26} r={7} />
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={{ y: -10, scale: 1.15, opacity: 0 }}
        animate={animated ? { y: [-10, 0, 0, -10], scale: [1.15, 1, 1, 1.15], opacity: [0, 1, 1, 0] } : { y: 0, scale: 1, opacity: 1 }}
        transition={{ ...LOOP, duration: 1.7, times: [0, 0.35, 0.7, 1] }}
      >
        <circle cx={40} cy={26} r={7.5} fill="color-mix(in srgb, currentColor 20%, transparent)" stroke="currentColor" strokeWidth={2.2} />
        {approval ? (
          <path d="M36.6 26 l2.2 2.3 L43.6 22.6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <text x={40} y={29} textAnchor="middle" fontSize="7" fontWeight="800" fill="currentColor">PF</text>
        )}
      </motion.g>
    </SvgScene>
  )
}

function SceneDelivery() {
  const animated = usePremiumMotion()
  return (
    <div className="relative h-full w-full">
      <SvgScene>
        <motion.g
          animate={animated ? { x: [-2, 2, -2], y: [0, -0.6, 0] } : undefined}
          transition={{ ...LOOP, duration: 1.4 }}
        >
          <CarGlyph spin wheelDur={0.55} />
        </motion.g>
        {/* speed lines */}
        {animated &&
          [0, 1, 2].map((i) => (
            <motion.line
              key={i}
              x1={4}
              y1={16 + i * 4}
              x2={12}
              y2={16 + i * 4}
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: [0, 0.7, 0], x: [4, -6] }}
              transition={{ ...LINEAR, duration: 0.7, delay: i * 0.16 }}
            />
          ))}
      </SvgScene>
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <Road y={36} />
      </div>
    </div>
  )
}

function SceneTransfer() {
  const animated = usePremiumMotion()
  const pin = (x: number) => (
    <g>
      <path d={`M${x} 12 c-3.4 0 -6 2.6 -6 6 c0 4.4 6 9 6 9 c0 0 6 -4.6 6 -9 c0 -3.4 -2.6 -6 -6 -6 Z`} fill="color-mix(in srgb, currentColor 16%, transparent)" stroke="currentColor" strokeWidth={1.8} />
      <circle cx={x} cy={18} r={2.2} fill="currentColor" />
    </g>
  )
  return (
    <SvgScene>
      <path d="M12 30 Q36 20 60 30" fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2.5 3" opacity={0.5} />
      {pin(12)}
      {pin(60)}
      <motion.g
        initial={{ opacity: 0 }}
        animate={animated ? { opacity: 1 } : { opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <motion.g
          animate={animated ? { x: [0, 48], y: [0, -4, 0] } : undefined}
          transition={{ ...LOOP, duration: 1.9, times: [0, 0.5, 1] }}
        >
          <g transform="translate(4 26) scale(0.44)">
            <CarGlyph spin wheelDur={0.5} />
          </g>
        </motion.g>
      </motion.g>
    </SvgScene>
  )
}

function SceneSearch() {
  const animated = usePremiumMotion()
  return (
    <SvgScene>
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={12}
          y={12 + i * 6}
          width={48}
          height={4}
          rx={2}
          fill="color-mix(in srgb, currentColor 16%, transparent)"
          initial={{ opacity: 0.25 }}
          animate={animated ? { opacity: [0.25, 0.85, 0.25] } : undefined}
          transition={{ ...LOOP, duration: 1.2, delay: i * 0.2 }}
        />
      ))}
      <motion.circle
        cx={50}
        cy={19}
        r={7}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        animate={animated ? { x: [-30, 8, -30] } : undefined}
        transition={{ ...LOOP, duration: 2.4 }}
      />
      <motion.line
        x1={55}
        y1={24}
        x2={60}
        y2={29}
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        animate={animated ? { x: [-30, 8, -30] } : undefined}
        transition={{ ...LOOP, duration: 2.4 }}
      />
    </SvgScene>
  )
}

const SCENES: Record<LoaderVariant, React.ReactNode> = {
  generic: <SceneGeneric />,
  reserve: <SceneReserve />,
  allocate: <SceneAllocate />,
  'vin-match': <SceneVinMatch />,
  payment: <ScenePayment />,
  proforma: <SceneStamp />,
  approval: <SceneStamp approval />,
  delivery: <SceneDelivery />,
  transfer: <SceneTransfer />,
  search: <SceneSearch />,
}

const DEFAULT_LABELS: Record<LoaderVariant, string> = {
  generic: 'Working…',
  reserve: 'Reserving vehicle…',
  allocate: 'Allocating from stock…',
  'vin-match': 'Matching VIN…',
  payment: 'Verifying payment…',
  proforma: 'Preparing proforma…',
  approval: 'Applying approval…',
  delivery: 'Completing delivery…',
  transfer: 'Requesting transfer…',
  search: 'Searching…',
}

/* --------------------------------------------------------------- exports */

export function AutomotiveLoader({
  variant = 'generic',
  size = 72,
  label,
  sublabel,
  className,
}: {
  variant?: LoaderVariant
  size?: number
  label?: string | null
  sublabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center', className)}>
      <div style={{ width: size, height: size * 0.62, color: 'var(--dashboard-action-bg)' }}>{SCENES[variant]}</div>
      {label !== null && (
        <div>
          <p className="text-[13px] font-bold text-[var(--kia-text)]">{label ?? DEFAULT_LABELS[variant]}</p>
          {sublabel && <p className="mt-0.5 text-[11px] font-medium text-[var(--kia-text-soft)]">{sublabel}</p>}
        </div>
      )}
    </div>
  )
}

/** Full-cover frosted overlay for in-place operations (allocate, pay, etc.). */
export function LoaderOverlay({
  show,
  variant = 'generic',
  label,
  sublabel,
  className,
}: {
  show: boolean
  variant?: LoaderVariant
  label?: string
  sublabel?: string
  className?: string
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn('absolute inset-0 z-30 grid place-items-center', className)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ backgroundColor: 'color-mix(in srgb, var(--kia-surface) 72%, transparent)', backdropFilter: 'blur(6px)' }}
        >
          <motion.div
            initial={{ scale: 0.94, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <AutomotiveLoader variant={variant} label={label} sublabel={sublabel} size={92} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Small inline loader for buttons / dense rows. */
export function InlineLoader({ variant = 'generic', size = 20, className }: { variant?: LoaderVariant; size?: number; className?: string }) {
  return (
    <span className={cn('inline-block align-middle', className)} style={{ width: size, height: size * 0.62, color: 'inherit' }}>
      {SCENES[variant]}
    </span>
  )
}

/* --------------------------------------------------- success celebrations */

function CheckBurst() {
  const animated = usePremiumMotion()
  return (
    <svg viewBox="0 0 100 100" style={{ width: 104, height: 104, color: 'var(--dashboard-action-bg)' }}>
      {animated &&
        [0, 0.25].map((d, i) => (
          <motion.circle
            key={i}
            cx={50}
            cy={50}
            r={30}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            initial={{ scale: 0.6, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.2, delay: d, ease: 'easeOut' }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        ))}
      <motion.circle
        cx={50}
        cy={50}
        r={30}
        fill="color-mix(in srgb, currentColor 14%, transparent)"
        stroke="currentColor"
        strokeWidth={3}
        initial={animated ? { scale: 0 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 15 }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
      <motion.path
        d="M37 51 l9 9 L65 40"
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animated ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, delay: 0.18, ease: 'easeOut' }}
      />
      {animated &&
        [0, 60, 120, 180, 240, 300].map((deg, i) => {
          const rad = (deg * Math.PI) / 180
          return (
            <motion.circle
              key={`c-${i}`}
              cx={50}
              cy={50}
              r={2.4}
              fill="currentColor"
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{ opacity: [0, 1, 0], x: Math.cos(rad) * 36, y: Math.sin(rad) * 36 }}
              transition={{ duration: 0.9, delay: 0.28, ease: 'easeOut' }}
            />
          )
        })}
    </svg>
  )
}

function DeliveryBurst() {
  const animated = usePremiumMotion()
  return (
    <div className="relative" style={{ width: 132, height: 92, color: 'var(--dashboard-action-bg)' }}>
      <svg viewBox="0 0 100 60" className="h-full w-full">
        <motion.g
          initial={animated ? { x: -8, opacity: 0 } : false}
          animate={animated ? { x: [-8, 6, 74], opacity: [0, 1, 1, 0] } : { x: 0, opacity: 1 }}
          transition={{ duration: 1.5, times: [0, 0.22, 0.72, 1], ease: 'easeInOut' }}
        >
          <g transform="translate(14 6) scale(0.62)">
            <CarGlyph spin wheelDur={0.4} />
          </g>
        </motion.g>
      </svg>
      <div className="pointer-events-none absolute inset-x-3 bottom-1 opacity-70">
        <div className="kia-anim-road h-[3px]" />
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <motion.svg
          viewBox="0 0 40 40"
          style={{ width: 42, height: 42 }}
          initial={animated ? { scale: 0, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.9 }}
        >
          <circle cx={20} cy={20} r={16} fill="var(--kia-surface, #fff)" stroke="currentColor" strokeWidth={2.5} />
          <path d="M13 20 l5 5 L28 14" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </div>
    </div>
  )
}

/**
 * A one-shot success celebration overlay. Plays, then calls `onDone` after
 * `duration` ms so the caller can close the dialog / drawer.
 */
export function SuccessOverlay({
  show,
  variant = 'generic',
  label,
  sublabel,
  onDone,
  duration = 1700,
  className,
}: {
  show: boolean
  variant?: 'generic' | 'delivery'
  label?: string
  sublabel?: string
  onDone?: () => void
  duration?: number
  className?: string
}) {
  const doneRef = React.useRef(onDone)
  React.useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  React.useEffect(() => {
    if (!show) return
    const timer = setTimeout(() => doneRef.current?.(), duration)
    return () => clearTimeout(timer)
  }, [show, duration])
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn('absolute inset-0 z-40 grid place-items-center', className)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ backgroundColor: 'color-mix(in srgb, var(--kia-surface) 84%, transparent)', backdropFilter: 'blur(6px)' }}
        >
          <motion.div
            className="flex flex-col items-center gap-3 text-center"
            initial={{ scale: 0.94, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          >
            {variant === 'delivery' ? <DeliveryBurst /> : <CheckBurst />}
            {label && (
              <div>
                <p className="text-[15px] font-extrabold text-[var(--kia-text)]">{label}</p>
                {sublabel && <p className="mt-0.5 text-xs font-medium text-[var(--kia-text-soft)]">{sublabel}</p>}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
