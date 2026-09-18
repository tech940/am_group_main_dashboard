import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { feedbackBranchLabel } from '@/lib/kia/feedback/constants'
import { verifyFeedbackToken } from '@/lib/kia/feedback/link'
import { walkInConsultantSuggestions } from '@/lib/kia/walk-in-leads/server'
import { CustomerFeedbackForm } from '@/features/kia/feedback/customer-feedback-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Showroom Visit Feedback | AM Kia',
  description: 'Share your AM Kia showroom visit experience.',
  robots: { index: false, follow: false },
}

/**
 * Public showroom customer feedback page.
 * Accessed via QR code scanned at the showroom desk or SMS link.
 */
export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const link = verifyFeedbackToken(token)
  if (!link.ok) notFound()

  const consultants = await walkInConsultantSuggestions(link.dealerCode).catch(() => [])

  return (
    <CustomerFeedbackForm
      token={token}
      branch={feedbackBranchLabel(link.dealerCode)}
      consultants={consultants}
    />
  )
}
