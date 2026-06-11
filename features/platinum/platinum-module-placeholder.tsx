import { MainLayout } from '@/components/layout/main-layout'

type PlatinumModulePlaceholderProps = {
  title: string
  eyebrow?: string
  description?: string
}

export function PlatinumModulePlaceholder({
  title,
  eyebrow = 'AM Platinum',
  description = 'This section is ready in the sidebar. Data screens can be connected as AM Platinum modules are added.',
}: PlatinumModulePlaceholderProps) {
  return (
    <MainLayout title="AM Platinum" subtitle="Module setup">
      <section className="rounded-[2rem] border border-white/70 bg-white p-8 shadow-xl shadow-slate-900/5">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-black text-slate-950">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">{description}</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {['Service', 'Sales', 'H Promise'].map((section) => (
            <div key={section} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Section</p>
              <p className="mt-2 text-lg font-black text-slate-950">{section}</p>
            </div>
          ))}
        </div>
      </section>
    </MainLayout>
  )
}
