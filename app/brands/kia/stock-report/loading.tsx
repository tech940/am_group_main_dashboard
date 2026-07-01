import { MainLayout } from '@/components/layout/main-layout'

export default function KiaStockReportLoading() {
  return (
    <MainLayout title="Stock Report" subtitle="AM Kia stock analytics workspace">
      <div className="space-y-6">
        <div className="h-64 animate-pulse rounded-[2rem] border border-slate-200 bg-white/80" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-[1.5rem] border border-slate-200 bg-white/80" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white/80" />
      </div>
    </MainLayout>
  )
}
