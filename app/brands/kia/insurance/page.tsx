import { forbidden, redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Insurance | AM Kia',
  description: 'AM Kia insurance operations and reporting',
}

export default async function KiaInsurancePage() {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'kia.insurance.view')
  if (!permission.allowed) {
    forbidden()
  }

  return (
    <div className="min-h-full bg-slate-100 p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#031430_0%,#064b82_100%)] px-6 py-8 text-white sm:px-10">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-100">AM Kia</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">Insurance</h1>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-10">
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <h2 className="text-xl font-black text-slate-900">Insurance section is ready</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
              The direct AM Kia Insurance workspace is now available from the sidebar. Insurance reports and
              operational screens can be connected here without placing the section inside a dropdown.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
