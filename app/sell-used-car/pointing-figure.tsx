/*
 * The hero figure (owner's artwork, 2026-09-18): an AM Group evaluator in the branded sweatshirt pointing at the
 * form — public/assets/sell-evaluator.webp, supplied by the owner, trimmed to its edges. What stays drawn here is
 * the soft shape behind him, the handwritten note's arrow and the burst beside the card.
 */

/** The soft organic shape behind the figure — not a stamped circle. */
export function FigureBackdrop() {
  return (
    <svg viewBox="0 0 350 400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <path
        d="M172 58 C252 52 322 112 322 200 C322 288 266 358 180 362 C94 366 26 304 24 216 C22 126 92 64 172 58 Z"
        fill="#e9eef2"
      />
      <circle cx="58" cy="92" r="13" fill="#dfe6ec" />
    </svg>
  )
}

/** The hand-drawn arrow from the callout to the form (desktop), or down to it (phones). */
export function CalloutArrow({ direction }: { direction: 'right' | 'down' }) {
  if (direction === 'down') {
    return (
      <svg viewBox="0 0 60 56" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 6 C30 8 44 22 42 46" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M34 40 L42 48 L49 38" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 80 60" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 8 C14 38 40 52 72 46" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M62 38 L73 46 L62 55" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Three strokes beside the card, as in the mock — a small "look here". */
export function Burst() {
  return (
    <svg viewBox="0 0 40 80" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path d="M6 12 L24 2" />
        <path d="M6 40 L32 40" />
        <path d="M6 68 L24 78" />
      </g>
    </svg>
  )
}
