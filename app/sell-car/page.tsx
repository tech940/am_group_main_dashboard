import type { Metadata } from 'next'
import { EvaluationLandingClient } from '@/components/evaluation/evaluation-landing-client'

export const metadata: Metadata = {
  title: 'Free Car Valuation & Doorstep Inspection | AM Group Jammu',
  description:
    'Get an instant fair valuation and schedule a free doorstep inspection for your used car in Jammu & Kashmir. Best price, same-day payment & free RC transfer by AM Group.',
}

export default function SellCarPage() {
  return <EvaluationLandingClient />
}
