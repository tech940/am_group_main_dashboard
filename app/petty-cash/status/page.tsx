'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { PettyCashStatusBoard } from '@/components/petty-cash/petty-cash-status-board'

export default function PettyCashStatusPage() {
  return (
    <MainLayout title="Petty Cash · Status" subtitle="Approval stage, pending approver & time waiting">
      <PettyCashStatusBoard />
    </MainLayout>
  )
}
