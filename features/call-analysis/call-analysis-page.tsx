import { MainLayout } from '@/components/layout/main-layout'
import { AmGroupCallAnalysis } from './am-group-call-analysis'

export function CallAnalysisPage() {
  return (
    <MainLayout title="Call Analysis" subtitle="Call volume, agent performance, customer matching & recordings">
      <AmGroupCallAnalysis />
    </MainLayout>
  )
}
