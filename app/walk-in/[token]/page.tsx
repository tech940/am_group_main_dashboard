import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getIndiaYmd } from '@/lib/date-time'
import { walkInBranchLabel } from '@/lib/kia/walk-in-leads/constants'
import { verifyWalkInToken } from '@/lib/kia/walk-in-leads/link'
import { walkInConsultantSuggestions } from '@/lib/kia/walk-in-leads/server'
import { WalkInForm } from '@/features/kia/walk-in-leads/walk-in-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Walk-in Register | AM Kia',
  description: 'Record a showroom walk-in for AM Kia.',
  robots: { index: false, follow: false },
}

/**
 * ⚠️ PUBLIC — no login (owner's request). `/walk-in` is not a protected prefix in lib/supabase/middleware.ts.
 * The signed token in the path is the only key: a bad one is a 404, and it fixes the branch.
 */
export default async function WalkInFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = verifyWalkInToken(token)
  if (!link.ok) notFound()
  const consultants = await walkInConsultantSuggestions(link.dealerCode).catch(() => [])
  return (
    <WalkInForm
      token={token}
      branch={walkInBranchLabel(link.dealerCode)}
      consultants={consultants}
      today={getIndiaYmd()}
    />
  )
}
