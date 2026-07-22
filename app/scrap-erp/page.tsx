import { MainLayout } from '@/components/layout/main-layout'
import { ScrapErpShell } from '@/features/scrap-erp/ScrapErpShell'

export const metadata = {
  title: 'Scrap Management | AM Group',
  description: 'Scrap disposal, dynamic master records, reports & sales analytics.',
}

export default function ScrapErpPage() {
  return (
    <MainLayout title="Scrap Management" subtitle="Scrap disposal, dynamic master records, reports & sales analytics">
      <ScrapErpShell />
    </MainLayout>
  )
}
