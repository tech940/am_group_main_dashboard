import { MainLayout } from '@/components/layout/main-layout'

export default function KiaStockManagementLoading() {
  return (
    <MainLayout title="Stock Management" subtitle="AM KIA SALES CONTROL">
      <div className="min-h-screen bg-[linear-gradient(180deg,#edf3f9_0%,#e8eef6_100%)] p-6">
        <div className="mb-6 h-44 animate-pulse rounded-[2rem] bg-white/80 shadow-sm" />
        <div className="grid gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-3xl bg-white/80 shadow-sm" />
          ))}
        </div>
        <div className="mt-6 h-[420px] animate-pulse rounded-[2rem] bg-white/80 shadow-sm" />
      </div>
    </MainLayout>
  )
}
