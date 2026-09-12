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
  /** Size multiplier: 'sm' | 'md' | 'lg' */
  size?: 'sm' | 'md' | 'lg'
}

/**
 * AM stylized geometric logo SVG mark.
 * Authentic geometric monogram matching corporate brand assets.
 */
export function AmGlyph({ className, color = 'currentColor' }: { className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 66 26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-6.5 sm:h-7.5 w-auto shrink-0 drop-shadow-2xs', className)}
      aria-label="AM"
    >
      {/* Letter 'A' with inner triangle counter */}
      <path
        d="M20 0.5 L39 24.5 L31 24.5 L20 10.5 L9 24.5 L1 24.5 Z"
        fill={color}
      />
      {/* Letter 'M' with left diagonal, center valley, and right vertical bar */}
      <polygon points="31,0.5 39,0.5 53,20.5 45,20.5" fill={color} />
      <polygon points="45,20.5 53,20.5 64,0.5 56,0.5" fill={color} />
      <polygon points="56,0.5 64,0.5 64,24.5 56,24.5" fill={color} />
    </svg>
  )
}

/**
 * The brand half of the lockup.
 *
 * ⚠️ These are FILES, deliberately. Until 2026-09-12 each mark was an SVG path written by hand and commented
 * "official" — the Honda one rendered as an unrecognisable red blob on the approval form, and Tata, Bajaj and
 * Hyundai were invented shapes too. A brand mark cannot be approximated: it is either the real artwork or it
 * is wrong. The files in public/brand-logos are the brands' own marks, each painted its official colour.
 *
 * A brand with no file below shows its NAME as text rather than a stand-in mark.
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
  // The MG badge is a small octagon; at row size the letters inside it are unreadable, so the name sits
  // beside it as it does for the other symbol marks.
  mg: { src: '/brand-logos/mg.svg', alt: 'MG', wordmark: 'MG', wordmarkColor: '#FF0000' },
  bajaj: { src: '/brand-logos/bajaj.svg', alt: 'Bajaj', wide: true },

  // Symbols — the brand name sits beside the mark, as it does on the brands' own signage.
  hyundai: { src: '/brand-logos/hyundai.svg', alt: 'Hyundai', wordmark: 'HYUNDAI', wordmarkColor: '#002C5E' },
  tata: { src: '/brand-logos/tata.svg', alt: 'Tata', wordmark: 'TATA', wordmarkColor: '#1B365D' },

  // AM Diamond Honda: the Honda mark, named in full.
  honda: { src: '/brand-logos/honda.svg', alt: 'Diamond Honda', wordmark: 'DIAMOND HONDA', wordmarkColor: '#2D0000' },
  diamond: { src: '/brand-logos/honda.svg', alt: 'Diamond Honda', wordmark: 'DIAMOND HONDA', wordmarkColor: '#2D0000' },

  // AM Platinum is a Hyundai dealership, and carries the Hyundai mark under its own name — the same pairing
  // components/layout/sidebar.tsx already uses for it.
  platinum: { src: '/brand-logos/hyundai.svg', alt: 'AM Platinum', wordmark: 'PLATINUM', wordmarkColor: '#002C5E' },
}

function BrandMark({
  brand,
  isLight = false,
  size = 'md',
}: {
  brand: string
  isLight?: boolean
  size?: 'sm' | 'md' | 'lg'
}) {
  const norm = brand.toLowerCase().trim()
  const spec = BRAND_MARKS[norm]

  if (spec) {
    const height = size === 'sm' ? 'h-5' : size === 'lg' ? 'h-8' : 'h-6 sm:h-7'
    return (
      <div className="flex items-center gap-2 sm:gap-2.5">
        <img
          src={spec.src}
          alt={spec.alt}
          className={cn(
            height,
            'w-auto shrink-0 object-contain',
            spec.wide ? 'max-w-[132px]' : 'max-w-[88px]',
            // On a dark header the coloured mark is repainted white, the same treatment the AM glyph gets.
            isLight && '[filter:brightness(0)_invert(1)]',
          )}
        />
        {spec.wordmark && (
          <span
            className={cn(
              // nowrap: a two-word name like DIAMOND HONDA otherwise wraps and makes its row taller than the rest.
              'font-black tracking-widest whitespace-nowrap',
              size === 'sm' ? 'text-xs sm:text-sm' : size === 'lg' ? 'text-lg' : 'text-sm sm:text-base',
              isLight && 'text-white',
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
    norm === 'group' || norm === '' ? 'GROUP' : brand.replace(/^\s*AM\s+/i, '').toUpperCase()

  return (
    <span
      className={cn(
        'font-black uppercase tracking-[0.2em]',
        isLight ? 'text-white' : 'text-slate-800',
        size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-lg' : 'text-sm sm:text-base',
      )}
    >
      {displayName}
    </span>
  )
}

/**
 * Main BrandLogoLockup component.
 * Produces the official:
 * [ AM Monogram ] | [ Brand Logo / Badge ]
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
          'rounded-lg bg-white px-3.5 py-1.5 sm:px-4 sm:py-2 shadow-xs border border-slate-200/90',
        className
      )}
    >
      {/* Left: AM Monogram */}
      <div className="flex items-center">
        <AmGlyph
          color={amColor}
          className={cn(
            size === 'sm'
              ? 'h-5 sm:h-6'
              : size === 'lg'
              ? 'h-8 sm:h-9'
              : 'h-6 sm:h-7'
          )}
        />
      </div>

      {/* Center: Thin vertical dividing bar */}
      <div
        className={cn(
          'mx-3 sm:mx-4.5 w-px self-stretch min-h-[24px] sm:min-h-[28px]',
          isLight ? 'bg-white/30' : 'bg-slate-300'
        )}
      />

      {/* Right: Brand Mark (KIA, MG, DIAMOND, HYUNDAI, TATA, etc.) */}
      <div className="flex items-center">
        <BrandMark brand={brand} isLight={isLight} size={size} />
      </div>
    </div>
  )
}
