import { Suspense } from 'react'
import { AdminConsole } from '@/features/admin/admin-console'

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading Admin Console...</div>}>
      <AdminConsole />
    </Suspense>
  )
}
