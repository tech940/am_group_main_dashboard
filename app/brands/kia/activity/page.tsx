import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { MainLayout } from '@/components/layout/main-layout'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { Activity, CheckCircle2, XCircle, Clock, ShieldCheck, UserCheck, PauseCircle, Car, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata = {
  title: 'Activity Log | Kia Management',
  description: 'Audit trail of proforma approvals, holds, allocations, and user activity.',
}

export const dynamic = 'force-dynamic'

type ActivityRecord = {
  id: string
  booking_id: string | null
  activity_type: string
  title: string
  description: string | null
  actor_name: string | null
  actor_role: string | null
  created_at: string
  booking_number?: string | null
  customer_name?: string | null
}

export default async function KiaActivityPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const hasKiaAccess = canAccessBrand(appUser, 'kia')
  if (!hasKiaAccess) redirect('/forbidden')

  const rowsResult = await db.execute(sql.raw(`
    SELECT
      a.id,
      a.booking_id,
      a.activity_type,
      a.title,
      a.description,
      a.actor_name,
      a.actor_role,
      a.created_at,
      kb.booking_number,
      kb.customer_name
    FROM kia_booking_activity a
    LEFT JOIN kia_bookings kb ON kb.id = a.booking_id
    ORDER BY a.created_at DESC
    LIMIT 200
  `))

  const activities = (rowsResult as unknown as ActivityRecord[]) || []

  return (
    <MainLayout title="Kia Activity Log" subtitle="Complete audit trail of approvals, status changes, holds, and workflow events">
      <div className="space-y-6 p-4 md:p-6">
        {/* Top Header Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/80 p-2.5 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                Kia Approval Chain & Activity Audit Log
                <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 text-[10px] font-black">
                  {activities.length} Events Logged
                </Badge>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                Tracks exact stage approvals (Sales Manager / GM → Finance MK Pandita), hold remarks, VIN allocations, and manual actions.
              </p>
            </div>
          </div>
        </div>

        {/* Activity Table */}
        <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-3 bg-slate-50/50 dark:bg-slate-950/40">
            <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Chronological Audit Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
              <Table className="w-full text-left text-xs border-collapse">
                <TableHeader className="sticky top-0 z-10 bg-slate-900 text-white dark:bg-slate-800 border-b border-slate-800">
                  <TableRow>
                    <TableHead className="text-[10px] font-black uppercase tracking-wider text-slate-100 py-3">Timestamp</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-wider text-slate-100 py-3">Activity Type</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-wider text-slate-100 py-3">Event & Description</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-wider text-slate-100 py-3">Booking #</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-wider text-slate-100 py-3">Performed By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {activities.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-400 font-bold">
                        No activity records logged yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    activities.map((act) => {
                      const dt = new Date(act.created_at)
                      const formattedDate = isNaN(dt.getTime())
                        ? act.created_at
                        : dt.toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })

                      let badgeStyle = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      const typeLower = (act.activity_type || '').toLowerCase()
                      if (typeLower.includes('approval') || typeLower.includes('proforma')) {
                        badgeStyle = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-200'
                      } else if (typeLower.includes('hold')) {
                        badgeStyle = 'bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200'
                      } else if (typeLower.includes('decline') || typeLower.includes('cancel')) {
                        badgeStyle = 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200'
                      } else if (typeLower.includes('accounts') || typeLower.includes('deliver') || typeLower.includes('allot')) {
                        badgeStyle = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200'
                      }

                      return (
                        <TableRow key={act.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <TableCell className="py-3 px-4 font-bold text-slate-500 whitespace-nowrap">
                            {formattedDate}
                          </TableCell>

                          <TableCell className="py-3 px-4 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] font-black uppercase ${badgeStyle}`}>
                              {act.activity_type || 'system'}
                            </Badge>
                          </TableCell>

                          <TableCell className="py-3 px-4">
                            <div className="font-extrabold text-slate-900 dark:text-slate-100">
                              {act.title}
                            </div>
                            {act.description && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                                {act.description}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="py-3 px-4 font-black text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {act.booking_number ? `#${act.booking_number}` : '-'}
                            {act.customer_name && (
                              <span className="block text-[10px] text-slate-400 font-normal">
                                {act.customer_name}
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="py-3 px-4 whitespace-nowrap">
                            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5 text-indigo-500" />
                              {act.actor_name || 'System User'}
                            </div>
                            {act.actor_role && (
                              <div className="text-[10px] text-slate-400 font-bold uppercase">
                                {act.actor_role.replace(/_/g, ' ')}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  )
}
