import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaProformas } from '@/lib/db/schema'
import { canApproveKiaProforma } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const [row] = await db.select().from(kiaProformas).where(and(eq(kiaProformas.id, id), isNull(kiaProformas.deletedAt))).limit(1)
  if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })
  if (row.loginEmail !== appUser.email && !canApproveKiaProforma(appUser.role, profile.approver)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const html = `<!doctype html>
  <html>
    <head>
      <title>Kia Proforma ${row.customerName}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:32px;color:#0f172a}
        .card{border:1px solid #dbe3ef;border-radius:18px;padding:24px;max-width:860px;margin:auto}
        h1{margin:0 0 8px;font-size:28px}
        table{width:100%;border-collapse:collapse;margin-top:20px}
        td{border-bottom:1px solid #e5e7eb;padding:10px;font-size:14px}
        td:first-child{font-weight:700;color:#64748b;width:36%}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>AM Kia Proforma</h1>
        <p>Approved proforma preview. PDF storage generation can be connected here later.</p>
        <table>
          <tr><td>Customer</td><td>${row.customerName}</td></tr>
          <tr><td>Mobile</td><td>${row.mobileNumber}</td></tr>
          <tr><td>Model</td><td>${row.modelName} / ${row.trimDescription}</td></tr>
          <tr><td>Bank</td><td>${row.bankName} ${row.bankBranch || ''}</td></tr>
          <tr><td>Grand Total</td><td>Rs ${Number(row.grandTotalCost || 0).toLocaleString('en-IN')}</td></tr>
          <tr><td>Approval</td><td>${row.approvalStatus}</td></tr>
          <tr><td>Approved By</td><td>${row.approvedBy || '-'}</td></tr>
        </table>
      </div>
    </body>
  </html>`

  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
