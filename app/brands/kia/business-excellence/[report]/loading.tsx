export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-[1.25rem] bg-white shadow-sm" />
        <div className="h-16 animate-pulse rounded-[1.25rem] bg-white shadow-sm" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-[1.5rem] bg-white shadow-sm" />
          ))}
        </div>
        <div className="h-[460px] animate-pulse rounded-[2rem] bg-white shadow-sm" />
      </div>
    </div>
  )
}
