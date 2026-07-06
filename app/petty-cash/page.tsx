'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { PettyCashWorkspace } from '@/components/petty-cash/petty-cash-workspace'

export default function PettyCashPage() {
  return (
    <MainLayout title="Petty Cash" subtitle="Allocations, spends & approvals">
      <PettyCashWorkspace />
    </MainLayout>
  )
}
