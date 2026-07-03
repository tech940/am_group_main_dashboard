import { MainLayout } from '@/components/layout/main-layout'

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[1.5rem] bg-white/75 shadow-sm ${className}`} />
}

export default function Loading() {
  return (
    <MainLayout title="Bookings CRM" subtitle="AM Kia customer journey workspace">
      <div className="space-y-5">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-10 w-72" />
          <div className="mt-6 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
          </div>
        </section>
        <Skeleton className="h-24" />
        <Skeleton className="h-[520px]" />
      </div>
    </MainLayout>
  )
}
