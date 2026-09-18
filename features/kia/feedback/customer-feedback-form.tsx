'use client'

import * as React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Heart,
  Loader2,
  MapPin,
  RotateCcw,
  Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FEEDBACK_IMPROVEMENT_TAGS,
  FEEDBACK_POSITIVE_TAGS,
  FEEDBACK_RATING_METRICS,
} from '@/lib/kia/feedback/constants'
import { feedbackSubmitSchema } from '@/lib/kia/feedback/schemas'
import { fieldErrors, type FieldErrors } from '@/lib/kia/walk-in-leads/schemas'

type RatingKey = 1 | 2 | 3 | 4 | 5

type FormState = {
  overallRating: number
  staffCourtesyRating: number
  testDriveRating: number
  showroomAmbienceRating: number
  experienceTags: string[]
  remarks: string
  website: string
}

const blankState: FormState = {
  overallRating: 0,
  staffCourtesyRating: 0,
  testDriveRating: 0,
  showroomAmbienceRating: 0,
  experienceTags: [],
  remarks: '',
  website: '',
}

export function CustomerFeedbackForm({
  token,
  branch,
}: {
  token: string
  branch: string
  consultants?: string[]
}) {
  const [form, setForm] = React.useState<FormState>(blankState)
  const [hoverRating, setHoverRating] = React.useState<number>(0)
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [status, setStatus] = React.useState<'idle' | 'submitting' | 'submitted'>('idle')
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [submittedRating, setSubmittedRating] = React.useState<number>(5)

  const activeOverall = hoverRating || form.overallRating
  const metric = activeOverall > 0 ? FEEDBACK_RATING_METRICS[activeOverall as RatingKey] : null
  const isPositive = (form.overallRating || activeOverall) >= 4
  const availableTags = (form.overallRating || activeOverall) >= 4 ? FEEDBACK_POSITIVE_TAGS : FEEDBACK_IMPROVEMENT_TAGS

  const toggleTag = (tag: string) => {
    setForm((current) => {
      const exists = current.experienceTags.includes(tag)
      const nextTags = exists ? current.experienceTags.filter((t) => t !== tag) : [...current.experienceTags, tag]
      return { ...current, experienceTags: nextTags }
    })
  }

  const handleRatingSelect = (rating: number) => {
    setForm((current) => ({
      ...current,
      overallRating: rating,
      experienceTags: [],
    }))
    setErrors((current) => {
      const copy = { ...current }
      delete copy.overallRating
      return copy
    })
    setServerError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)

    if (form.overallRating === 0) {
      setErrors({ overallRating: 'Please select your rating above.' })
      setServerError('Please select your overall experience above.')
      window.scrollTo({ top: 120, behavior: 'smooth' })
      return
    }

    const payload = {
      overallRating: form.overallRating,
      staffCourtesyRating: form.staffCourtesyRating || undefined,
      testDriveRating: form.testDriveRating || undefined,
      showroomAmbienceRating: form.showroomAmbienceRating || undefined,
      experienceTags: form.experienceTags,
      remarks: form.remarks || undefined,
      website: form.website,
    }

    const checked = feedbackSubmitSchema.safeParse(payload)
    if (!checked.success) {
      setErrors(fieldErrors(checked.error))
      setServerError('Please check your rating.')
      return
    }

    setStatus('submitting')
    try {
      const response = await fetch(`/api/feedback/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: FieldErrors }
      if (!response.ok) {
        if (body.fieldErrors) setErrors(body.fieldErrors)
        setServerError(body.error ?? 'Feedback could not be saved. Please try again.')
        setStatus('idle')
        return
      }

      setSubmittedRating(form.overallRating)
      setStatus('submitted')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setServerError('Network connection issue. Please check your connection and tap Submit again.')
      setStatus('idle')
    }
  }

  const resetForm = () => {
    setForm(blankState)
    setErrors({})
    setServerError(null)
    setStatus('idle')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="min-h-dvh bg-slate-100 pb-20 font-sans text-slate-900 antialiased selection:bg-slate-900 selection:text-white">
      {/* Header */}
      <header className="bg-[#05141f] px-4 pb-10 pt-7 text-white shadow-md sm:px-6">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <img
              src="/brand-logos/am-kia-wide.svg"
              alt="AM Kia"
              className="h-9 w-auto max-w-[210px] object-contain sm:h-11 sm:max-w-[260px]"
            />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white/95 backdrop-blur-xs">
              <MapPin className="h-3.5 w-3.5 text-white/75" aria-hidden="true" />
              {branch}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Guest Experience &amp; Feedback</h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slate-300">
              Your feedback helps us elevate our hospitality and automotive experience.
            </p>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="mx-auto -mt-4 max-w-xl px-3 sm:px-4">
        {status === 'submitted' ? (
          <section className="animate-in fade-in zoom-in-95 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg duration-300 sm:p-8" aria-live="polite">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-900 border border-indigo-200/80">
              {submittedRating >= 4 ? (
                <Heart className="h-8 w-8 fill-indigo-900 text-indigo-900" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-indigo-900" aria-hidden="true" />
              )}
            </div>

            <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {submittedRating >= 4 ? 'Thank You for Your Generous Feedback!' : 'Thank You for Helping Us Improve'}
            </h2>

            <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">
              {submittedRating >= 4
                ? 'We are delighted you had a memorable experience with our team at AM Kia. We look forward to welcoming you again!'
                : 'We take your feedback seriously. Our showroom leadership will review your notes to ensure we continuously improve.'}
            </p>

            <div className="mt-6 flex flex-col gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#05141f] text-[15px] font-semibold text-white shadow-md transition-colors hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Submit another response
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            {/* 1. OVERALL RATING SECTION */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
              <div className="text-center">
                <span className="inline-block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  Overall Experience <span className="text-rose-600">*</span>
                </span>
                <h2 className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">
                  How was your showroom visit today?
                </h2>

                {/* 5 Modern Clean Tactile Vector Sentiment Buttons (No Text Clutter) */}
                <div
                  role="radiogroup"
                  aria-label="Overall showroom rating"
                  className="mt-6 flex items-center justify-center gap-2 sm:gap-3.5"
                  onMouseLeave={() => setHoverRating(0)}
                >
                  {[1, 2, 3, 4, 5].map((rating) => {
                    const isSelected = form.overallRating === rating
                    const isHovered = hoverRating === rating

                    return (
                      <button
                        key={rating}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`Rating ${rating} out of 5`}
                        onClick={() => handleRatingSelect(rating)}
                        onMouseEnter={() => setHoverRating(rating)}
                        onFocus={() => setHoverRating(rating)}
                        onBlur={() => setHoverRating(0)}
                        className={cn(
                          'group relative flex h-14 w-14 items-center justify-center rounded-2xl border transition-all duration-200 cursor-pointer sm:h-16 sm:w-16',
                          isSelected
                            ? 'border-[#05141f] bg-[#05141f] text-white shadow-md scale-108 ring-2 ring-slate-900 ring-offset-2'
                            : isHovered
                            ? 'border-slate-400 bg-slate-100 text-slate-900 scale-105'
                            : 'border-slate-200 bg-slate-50/80 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900',
                        )}
                      >
                        <ModernSentimentIcon
                          rating={rating}
                          active={isSelected}
                          className="h-8 w-8 transition-transform duration-200 group-hover:scale-105 sm:h-9 sm:w-9"
                        />
                      </button>
                    )
                  })}
                </div>

                {errors.overallRating && (
                  <p className="mt-2.5 text-xs font-semibold text-rose-600" role="alert">
                    {errors.overallRating}
                  </p>
                )}

                {/* Dynamic Sentiment Banner */}
                {metric ? (
                  <div
                    className={cn(
                      'mt-5 animate-in fade-in slide-in-from-top-2 rounded-xl border p-4 text-left duration-200',
                      metric.themeBg,
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-2xs border border-slate-200/60">
                        <ModernSentimentIcon rating={form.overallRating || activeOverall} className="h-6 w-6 text-slate-900" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider', metric.badgeClass)}>
                            {metric.label}
                          </span>
                        </div>
                        <h3 className="mt-0.5 text-[14.5px] font-bold text-slate-900">{metric.headline}</h3>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-700">{metric.description}</p>
                  </div>
                ) : (
                  <p className="mt-4 text-xs font-medium text-slate-400">
                    Tap an expression above to rate your visit
                  </p>
                )}
              </div>

              {/* Dynamic Quick Feedback Tags */}
              {form.overallRating > 0 && (
                <div className="mt-6 border-t border-slate-100 pt-5">
                  <label className="block text-[12.5px] font-bold text-slate-700">
                    {isPositive ? 'What made your visit great?' : 'What could have been better?'}
                    <span className="ml-1 text-[11px] font-normal text-slate-400">(Select all that apply)</span>
                  </label>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {availableTags.map((tag) => {
                      const selected = form.experienceTags.includes(tag)
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className={cn(
                            'rounded-xl border px-3 py-2 text-xs font-semibold transition-all cursor-pointer select-none',
                            selected
                              ? 'border-[#05141f] bg-[#05141f] text-white shadow-xs'
                              : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-slate-100',
                          )}
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* 2. SPECIFIC EXPERIENCE RATINGS */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Showroom Experience Breakdown
              </span>
              <p className="mt-1 text-xs text-slate-500">Rate specific aspects of your visit (optional)</p>

              <div className="mt-4 space-y-4 divide-y divide-slate-100">
                <AspectRatingRow
                  label="Staff Courtesy & Hospitality"
                  sub="Greeting, attentiveness, and warmth"
                  value={form.staffCourtesyRating}
                  onChange={(val) => setForm((c) => ({ ...c, staffCourtesyRating: val }))}
                />
                <AspectRatingRow
                  label="Test Drive Experience"
                  sub="Vehicle availability, route, and driving guidance"
                  value={form.testDriveRating}
                  onChange={(val) => setForm((c) => ({ ...c, testDriveRating: val }))}
                />
                <AspectRatingRow
                  label="Showroom Ambience & Comfort"
                  sub="Cleanliness, air conditioning, and customer lounge"
                  value={form.showroomAmbienceRating}
                  onChange={(val) => setForm((c) => ({ ...c, showroomAmbienceRating: val }))}
                />
              </div>
            </section>

            {/* 3. DETAILED REMARKS */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
              <label htmlFor="remarks" className="flex items-baseline justify-between gap-2 text-[13px] font-bold text-slate-800">
                <span>Detailed Remarks &amp; Suggestions</span>
                <span className="text-[11px] font-normal text-slate-400">Optional</span>
              </label>
              <textarea
                id="remarks"
                rows={3}
                value={form.remarks}
                onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))}
                maxLength={1000}
                placeholder={
                  form.overallRating >= 4
                    ? 'Tell us what stood out or any compliments for the staff...'
                    : 'Please tell us what went wrong or how we can make it right...'
                }
                className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3 text-[14px] font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500"
              />

              {/* Honeypot */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))}
                />
              </div>
            </section>

            {serverError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-medium text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {serverError}
              </p>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="sticky bottom-3 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#05141f] py-3.5 text-[15.5px] font-bold text-white shadow-xl transition-all hover:bg-slate-900 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 cursor-pointer"
            >
              {status === 'submitting' ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {status === 'submitting' ? 'Submitting feedback…' : 'Submit Feedback'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

/**
 * Clean, modern Apple/Emil-inspired vector sentiment icons.
 * Replaces cartoonish OS emojis with crisp minimalist geometry.
 */
function ModernSentimentIcon({
  rating,
  className,
  active,
}: {
  rating: number
  className?: string
  active?: boolean
}) {
  if (rating === 1) {
    // Disappointed: clean sad brows + frown
    return (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="16" cy="16" r="13" />
        <circle cx="11.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="20.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <path d="M10 10.5c1.2.6 2.4.6 3.5 0" />
        <path d="M18.5 10.5c1.1-.6 2.3-.6 3.5 0" />
        <path d="M11 21.5c1.5-2 3.2-3 5-3s3.5 1 5 3" />
      </svg>
    )
  }
  if (rating === 2) {
    // Needs Work: soft downturned mouth
    return (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="16" cy="16" r="13" />
        <circle cx="11.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="20.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <path d="M11.5 20.5c1.5-1.2 3-1.8 4.5-1.8s3 .6 4.5 1.8" />
      </svg>
    )
  }
  if (rating === 3) {
    // Fair / Neutral: straight line
    return (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="16" cy="16" r="13" />
        <circle cx="11.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="20.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <line x1="11.5" y1="20" x2="20.5" y2="20" />
      </svg>
    )
  }
  if (rating === 4) {
    // Great: gentle warm smile
    return (
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="16" cy="16" r="13" />
        <circle cx="11.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="20.5" cy="13.5" r="1.5" fill="currentColor" stroke="none" />
        <path d="M11 18.5c1.5 2 3.2 3 5 3s3.5-1 5-3" />
      </svg>
    )
  }
  // 5 - Delighted: happy joyful eyes + radiant open smile
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="16" cy="16" r="13" />
      <path d="M9.5 13.5c.8-1.5 2.2-2 3.5-1.5" />
      <path d="M19 12c1.3-.5 2.7 0 3.5 1.5" />
      <path d="M10.5 18c1.6 3 3.5 4.5 5.5 4.5s3.9-1.5 5.5-4.5" />
    </svg>
  )
}

function AspectRatingRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string
  sub: string
  value: number
  onChange: (val: number) => void
}) {
  return (
    <div className="pt-3.5 first:pt-0">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h4 className="text-[13px] font-semibold text-slate-800">{label}</h4>
          <p className="text-[11px] text-slate-500">{sub}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(value === s ? 0 : s)}
              aria-label={`Rate ${s} for ${label}`}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl border transition-all cursor-pointer select-none',
                value === s
                  ? 'border-[#05141f] bg-[#05141f] text-white shadow-xs scale-108'
                  : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800',
              )}
            >
              <ModernSentimentIcon rating={s} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
