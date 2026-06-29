import { MainLayout } from '@/components/layout/main-layout'

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />
}

export default function Loading() {
  return (
    <MainLayout title="Sales Report" subtitle="AM Kia sales analytics workspace">
      <div className="space-y-6 rounded-[2.4rem] bg-[linear-gradient(180deg,#edf3f9_0%,#eef3f8_38%,#e7eef6_100%)] p-4 pb-6 md:p-6">
        <div className="rounded-[2rem] border border-[#cbd8e4] bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-8 w-56" />
          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-32" />
          </div>
        </div>

        <div className="rounded-[2rem] border border-[#d5dfea] bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-10 w-28 rounded-full" />)}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-[2rem] border border-[#d5dfea] bg-white p-4 shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-10 w-20" />
              <Skeleton className="mt-6 h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-24" />
            </div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-[2rem] border border-[#d5dfea] bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
              <Skeleton className="mt-5 h-72 w-full" />
            </div>
          ))}
        </div>
      </div>
    </MainLayout>
  )
}
