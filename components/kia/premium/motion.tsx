'use client'

/**
 * Motion foundation for the KIA premium design system.
 *
 * Thin, opinionated wrappers over `motion/react` (Framer Motion) that:
 *  - respect `prefers-reduced-motion` everywhere,
 *  - expose a small set of tuned spring / easing presets so every surface
 *    moves with the same physical character, and
 *  - keep the calling components declarative.
 */

import * as React from 'react'
import {
  animate,
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from 'motion/react'
import { cn } from '@/lib/utils'

export { AnimatePresence, motion }

/** Shared motion character. Springs for interaction, eases for reveals. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_IO = [0.22, 1, 0.36, 1] as const
export const SPRING = { type: 'spring', stiffness: 340, damping: 28, mass: 0.7 } as const
export const SPRING_SOFT = { type: 'spring', stiffness: 220, damping: 26 } as const

export function usePremiumMotion() {
  const reduce = useReducedMotion()
  return !reduce
}

/* ------------------------------------------------------------------ Reveal */

type RevealProps = React.ComponentProps<typeof motion.div> & {
  delay?: number
  y?: number
  once?: boolean
}

/** Fades + rises into place the first time it enters the viewport. */
export function Reveal({ children, delay = 0, y = 14, once = true, className, ...rest }: RevealProps) {
  const animated = usePremiumMotion()
  return (
    <motion.div
      className={className}
      data-kia-motion=""
      initial={animated ? { opacity: 0, y } : false}
      whileInView={animated ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once, margin: '-48px' }}
      transition={{ duration: 0.5, delay, ease: EASE_OUT }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/* ----------------------------------------------------------------- Stagger */

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
}
const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
}

export function Stagger({
  children,
  className,
  as,
}: {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'section' | 'ul'
}) {
  const animated = usePremiumMotion()
  const Comp = (as ? (motion as unknown as Record<string, typeof motion.div>)[as] : motion.div) as typeof motion.div
  return (
    <Comp
      className={className}
      variants={staggerContainer}
      initial={animated ? 'hidden' : false}
      animate={animated ? 'show' : false}
    >
      {children}
    </Comp>
  )
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const animated = usePremiumMotion()
  return (
    <motion.div className={className} variants={animated ? staggerItem : undefined} data-kia-motion="">
      {children}
    </motion.div>
  )
}

/* -------------------------------------------------------------------- Lift */

type LiftProps = React.ComponentProps<typeof motion.div> & {
  y?: number
  scale?: number
  disabled?: boolean
}

/** Elevation-on-hover interaction. Lifts + gently scales; presses on tap. */
export function Lift({ children, className, y = -4, scale = 1.01, disabled, ...rest }: LiftProps) {
  const animated = usePremiumMotion()
  return (
    <motion.div
      className={className}
      whileHover={animated && !disabled ? { y, scale } : undefined}
      whileTap={animated && !disabled ? { scale: 0.992 } : undefined}
      transition={SPRING}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/* --------------------------------------------------------- AnimatedNumber */

type AnimatedNumberProps = {
  value: number
  format?: (value: number) => string
  duration?: number
  className?: string
}

/** Counts smoothly from the previous value to the next. */
export function AnimatedNumber({ value, format, duration = 0.9, className }: AnimatedNumberProps) {
  const animated = usePremiumMotion()
  const [display, setDisplay] = React.useState(value)
  const fromRef = React.useRef(value)
  const inViewRef = React.useRef<HTMLSpanElement>(null)
  const inView = useInView(inViewRef, { once: true, margin: '-24px' })

  React.useEffect(() => {
    // Drive the visible value exclusively through animate()'s onUpdate callback
    // (an async callback, not a synchronous setState in the effect body). When
    // motion is reduced or off-screen we run with duration 0 so it snaps.
    const controls = animate(fromRef.current, value, {
      duration: animated && inView ? duration : 0,
      ease: EASE_IO,
      onUpdate: (latest) => setDisplay(latest),
    })
    fromRef.current = value
    return () => controls.stop()
  }, [value, duration, animated, inView])

  const text = format ? format(display) : Math.round(display).toLocaleString('en-IN')
  return (
    <span ref={inViewRef} className={cn('kia-tnum', className)}>
      {text}
    </span>
  )
}

/* ------------------------------------------------------------ Count badge */

/** A small pulse used to draw attention to a freshly-changed value. */
export function Pulse({ children, trigger, className }: { children: React.ReactNode; trigger: unknown; className?: string }) {
  const animated = usePremiumMotion()
  return (
    <motion.span
      className={className}
      key={String(trigger)}
      initial={animated ? { scale: 0.85, opacity: 0.4 } : false}
      animate={animated ? { scale: 1, opacity: 1 } : false}
      transition={SPRING}
    >
      {children}
    </motion.span>
  )
}
