import { APPROVAL_ONLY_BRANCHES } from '@/lib/kia/approval-branches'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'

export const FEEDBACK_RATING_METRICS = {
  1: {
    rating: 1,
    emoji: '😞',
    label: 'Disappointed',
    headline: 'We sincerely apologize',
    description: 'We deeply regret that we fell short of your expectations. Please let us know what went wrong so management can immediately address it.',
    themeBg: 'bg-rose-50 border-rose-200 text-rose-900',
    badgeClass: 'bg-rose-100 text-rose-700 border-rose-300',
  },
  2: {
    rating: 2,
    emoji: '🙁',
    label: 'Needs Improvement',
    headline: 'We want to do better',
    description: 'Thank you for your candid feedback. Where did our showroom experience fall short today?',
    themeBg: 'bg-amber-50 border-amber-200 text-amber-900',
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-300',
  },
  3: {
    rating: 3,
    emoji: '😐',
    label: 'Fair / Satisfactory',
    headline: 'Thanks for visiting',
    description: 'We appreciate your time. What could we have done to make your visit truly exceptional?',
    themeBg: 'bg-slate-50 border-slate-200 text-slate-900',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  4: {
    rating: 4,
    emoji: '😊',
    label: 'Great Experience',
    headline: 'Glad you enjoyed your visit',
    description: 'Thank you! We are delighted you had a positive experience with our sales and showroom team.',
    themeBg: 'bg-slate-50 border-slate-300 text-slate-900',
    badgeClass: 'bg-slate-200 text-slate-800 border-slate-300',
  },
  5: {
    rating: 5,
    emoji: '🤩',
    label: 'Delighted & Outstanding',
    headline: 'Exceptional visit!',
    description: 'Outstanding! Thank you for choosing AM Kia. We are thrilled our team delivered a 5-star experience for you.',
    themeBg: 'bg-indigo-50/60 border-indigo-200 text-indigo-950',
    badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  },
} as const

export const FEEDBACK_POSITIVE_TAGS = [
  'Courteous & welcoming staff',
  'Clear vehicle explanation',
  'Smooth test drive',
  'Clean & luxury showroom',
  'Prompt refreshment & attention',
  'Transparent offer & pricing',
] as const

export const FEEDBACK_IMPROVEMENT_TAGS = [
  'Long wait time',
  'Test drive vehicle not ready',
  'Pricing / offer unclear',
  'Sales consultant occupied',
  'Showroom crowded / warm',
  'Follow-up clarity needed',
] as const

export const FEEDBACK_MODELS = [
  'SONET',
  'SELTOS',
  'SYROS',
  'SYROS EV',
  'CARENS',
  'CARENS CLAVIS',
  'CARENS CLAVIS EV',
  'CARNIVAL',
  'EV6',
  'EV9',
] as const

export type FeedbackBranch = { code: string; label: string }

export const FEEDBACK_BRANCHES: readonly FeedbackBranch[] = [
  ...KIA_BRANCH_DEALERS.map((dealer) => ({ code: dealer.dealerCode as string, label: dealer.label as string })),
  ...(APPROVAL_ONLY_BRANCHES.kia ?? []).map((branch) => ({ code: branch.code, label: branch.label })),
]

export function isFeedbackBranchCode(value: unknown): value is string {
  return typeof value === 'string' && FEEDBACK_BRANCHES.some((b) => b.code === value)
}

export function feedbackBranchLabel(code: string | null | undefined): string {
  return FEEDBACK_BRANCHES.find((b) => b.code === code)?.label ?? code ?? 'AM Kia Showroom'
}
