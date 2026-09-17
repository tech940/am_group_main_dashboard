'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export type BrandKey =
  | 'kia'
  | 'mg'
  | 'hyundai'
  | 'platinum'
  | 'tata'
  | 'honda'
  | 'toyota'
  | 'bajaj'
  | 'maruti'
  | 'suzuki'
  | 'skoda'
  | 'nexa'
  | 'ola'
  | 'group'
  | (string & {})

interface BrandLogoLockupProps {
  brand?: BrandKey | string
  /**
   * 'card': White pill / card container with subtle shadow & border (as in corporate presentation).
   * 'inline': Transparent background, dark text/icons (for light paper surfaces).
   * 'light': Transparent background, white text/icons (for dark / teal headers).
   */
  variant?: 'card' | 'inline' | 'light'
  className?: string
  /** Size multiplier: 'xs' | 'sm' | 'md' | 'lg' */
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

/**
 * Simple AM text mark replacing stylized SVG.
 */
export function AmGlyph({
  className,
  color = 'currentColor',
  size = 'md',
}: {
  className?: string
  color?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={cn(
        'font-bold tracking-tight shrink-0 select-none inline-flex items-center justify-center leading-none',
        size === 'xs'
          ? 'text-[10px] sm:text-[11px]'
          : size === 'sm'
          ? 'text-xs sm:text-[13px]'
          : size === 'lg'
          ? 'text-xl sm:text-2xl'
          : 'text-base sm:text-lg',
        className
      )}
      style={{ color }}
      aria-label="AM"
    >
      AM
    </span>
  )
}

/**
 * The brand half of the lockup.
 */
type BrandMarkSpec = {
  src: string
  alt: string
  /** Set only where the file is a symbol rather than a full wordmark (Honda's H, Hyundai's oval, Tata's T). */
  wordmark?: string
  wordmarkColor?: string
  /** Wide lockups (Bajaj) need more room than a square badge. */
  wide?: boolean
}

const BRAND_MARKS: Record<string, BrandMarkSpec> = {
  // Complete wordmarks — nothing to add beside them.
  kia: { src: '/brand-logos/kia.svg', alt: 'Kia', wide: true },
  ktm: { src: '/brand-logos/ktm.svg', alt: 'KTM', wide: true },
  mg: { src: '/brand-logos/mg.svg', alt: 'MG', wordmark: 'MG', wordmarkColor: '#FF0000' },
  bajaj: { src: '/brand-logos/bajaj.svg', alt: 'Bajaj', wide: true },

  // Symbols — the brand name sits beside the mark, as it does on the brands' own signage.
  hyundai: { src: '/brand-logos/hyundai.svg', alt: 'Hyundai', wordmark: 'HYUNDAI', wordmarkColor: '#002C5E' },
  tata: { src: '/brand-logos/tata.svg', alt: 'Tata', wordmark: 'TATA', wordmarkColor: '#1B365D' },

  // AM Diamond Honda: the official Honda wing mark from sidebar, named in full.
  honda: { src: '/brand-logos/diamond-honda.png', alt: 'Diamond Honda', wordmark: 'DIAMOND HONDA', wordmarkColor: '#2D0000' },
  diamond: { src: '/brand-logos/diamond-honda.png', alt: 'Diamond Honda', wordmark: 'DIAMOND HONDA', wordmarkColor: '#2D0000' },

  // AM Platinum is a Hyundai dealership, and carries the Hyundai mark under its own name
  platinum: { src: '/brand-logos/hyundai.svg', alt: 'AM Platinum', wordmark: 'PLATINUM', wordmarkColor: '#002C5E' },
}

function BrandMark({
  brand,
  isLight = false,
  size = 'md',
}: {
  brand: string
  isLight?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}) {
  const norm = brand.toLowerCase().trim()
  const spec = BRAND_MARKS[norm]

  if (spec) {
    const height =
      size === 'xs'
        ? 'h-2.5 sm:h-3'
        : size === 'sm'
        ? 'h-3.5 sm:h-4'
        : size === 'lg'
        ? 'h-6 sm:h-7'
        : 'h-4.5 sm:h-5'
    return (
      <div className="flex items-center gap-1 sm:gap-1.5">
        <img
          src={spec.src}
          alt={spec.alt}
          className={cn(
            height,
            'w-auto shrink-0 object-contain',
            spec.wide
              ? size === 'xs'
                ? 'max-w-[55px] sm:max-w-[65px]'
                : size === 'sm'
                ? 'max-w-[70px] sm:max-w-[85px]'
                : size === 'lg'
                ? 'max-w-[120px] sm:max-w-[140px]'
                : 'max-w-[80px] sm:max-w-[95px]'
              : size === 'xs'
              ? 'max-w-[40px] sm:max-w-[50px]'
              : size === 'sm'
              ? 'max-w-[50px] sm:max-w-[60px]'
              : size === 'lg'
              ? 'max-w-[80px] sm:max-w-[95px]'
              : 'max-w-[60px] sm:max-w-[70px]',
            // On a dark header the coloured mark is repainted white, the same treatment the AM glyph gets.
            isLight && '[filter:brightness(0)_invert(1)]',
          )}
        />
        {spec.wordmark && (
          <span
            className={cn(
              // nowrap: a two-word name like DIAMOND HONDA otherwise wraps and makes its row taller than the rest.
              'font-bold tracking-wider whitespace-nowrap leading-none',
              size === 'xs'
                ? 'text-[10px] sm:text-[11px]'
                : size === 'sm'
                ? 'text-xs sm:text-[13px]'
                : size === 'lg'
                ? 'text-xl sm:text-2xl'
                : 'text-base sm:text-lg',
              isLight ? 'text-white' : undefined,
            )}
            style={isLight ? undefined : { color: spec.wordmarkColor }}
          >
            {spec.wordmark}
          </span>
        )}
      </div>
    )
  }

  // No artwork for this brand: its name, set plainly. Never a stand-in mark.
  const displayName =
    norm === 'group' || norm === ''
      ? 'GROUP'
      : brand.replace(/^\s*AM\s+/i, '').replace(/_/g, ' ').toUpperCase()

  return (
    <span
      className={cn(
        'font-bold uppercase tracking-[0.12em] leading-none',
        isLight ? 'text-white' : 'text-slate-800',
        size === 'xs'
          ? 'text-[10px] sm:text-[11px]'
          : size === 'sm'
          ? 'text-xs sm:text-[13px]'
          : size === 'lg'
          ? 'text-xl sm:text-2xl'
          : 'text-base sm:text-lg',
      )}
    >
      {displayName}
    </span>
  )
}

/**
 * Main BrandLogoLockup component.
 * Produces the official:
 * [ AM ] | [ Brand Logo / Badge ]
 */
export function BrandLogoLockup({
  brand = 'group',
  variant = 'card',
  size = 'md',
  className,
}: BrandLogoLockupProps) {
  const isLight = variant === 'light'
  const isCard = variant === 'card'

  const amColor = isLight ? '#FFFFFF' : '#0F172A'

  return (
    <div
      className={cn(
        'inline-flex items-center select-none',
        isCard &&
          (size === 'xs'
            ? 'rounded-md bg-white px-2 py-1 shadow-2xs border border-slate-200/90'
            : size === 'sm'
            ? 'rounded-lg bg-white px-2.5 py-1.5 shadow-2xs border border-slate-200/90'
            : size === 'lg'
            ? 'rounded-xl bg-white px-4 py-2.5 shadow-xs border border-slate-200/90'
            : 'rounded-lg bg-white px-3 py-1.5 sm:px-3.5 sm:py-2 shadow-xs border border-slate-200/90'),
        className
      )}
    >
      {/* Left: Simple AM Text */}
      <div className="flex items-center justify-center">
        <AmGlyph
          color={amColor}
          size={size}
        />
      </div>

      {/* Center: Thin vertical dividing bar */}
      <div
        className={cn(
          size === 'xs'
            ? 'mx-1.5 min-h-[10px] sm:min-h-[11px]'
            : size === 'sm'
            ? 'mx-2 min-h-[12px] sm:min-h-[14px]'
            : size === 'lg'
            ? 'mx-3.5 sm:mx-4 min-h-[22px] sm:min-h-[24px]'
            : 'mx-2.5 sm:mx-3 min-h-[16px] sm:min-h-[18px]',
          'w-px self-stretch',
          isLight ? 'bg-white/30' : 'bg-slate-300'
        )}
      />

      {/* Right: Brand Mark (KIA, MG, DIAMOND, HYUNDAI, TATA, etc.) */}
      <div className="flex items-center justify-center">
        <BrandMark brand={brand} isLight={isLight} size={size} />
      </div>
    </div>
  )
}
