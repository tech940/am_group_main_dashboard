import { NextResponse } from 'next/server'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { discountApprovals } from '@/lib/db/schema'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { discountBranchesFor } from '@/lib/discount-approvals/access'
import { EXPORTABLE_STATUS, isExportable, parseDiscountExportFilters } from '@/lib/discount-approvals/filters'
import { buildDiscountExcel, buildDiscountPdf, exportFileName, type ExportRow } from '@/lib/discount-approvals/export'

export const dynamic = 'force-dynamic'

/**
 * GET /api/discount-approvals/export?format=xlsx|pdf&branch=&month=&insurance=&q=
 *
 * Approved AM Hyundai / AM Platinum discount requests, with the dashboard's filters (owner, 2026-09-19).
 *  - Only status APPROVED — the MD's final approval. Pending and rejected requests are never exported,
 *    whatever tab the dashboard has open.
 *  - Same access as the list (lib/discount-approvals/access.ts): the section permission, and only the
 *    branches this user may see; a branch they may not see is simply absent, never an error that leaks it.
 *  - Filters are applied by the SAME function the dashboard counts with (lib/discount-approvals/filters.ts),
 *    so "Export 16 approved" on the button is 16 rows in the file.
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const allowed = await discountBranchesFor(appUser)
  if (allowed.length === 0) {
    return NextResponse.json({ error: 'You do not have access to discount approvals' }, { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const format = params.get('format') === 'pdf' ? 'pdf' : 'xlsx'
  const filters = parseDiscountExportFilters(params)
  const branches = filters.branch !== 'all' ? allowed.filter((b) => b === filters.branch) : allowed

  try {
    const found = branches.length === 0 ? [] : await db
      .select()
      .from(discountApprovals)
      .where(and(eq(discountApprovals.status, EXPORTABLE_STATUS), inArray(sql`LOWER(${discountApprovals.branch})`, branches)))
      .orderBy(asc(discountApprovals.teleDate), asc(discountApprovals.createdAt))
    const rows = found.filter((r) => isExportable(r, filters)) as unknown as ExportRow[]

    const meta = { filters, generatedBy: appUser.fullName || appUser.email, generatedAt: new Date() }
    const fileName = exportFileName(filters, format, meta.generatedAt)
    const body = format === 'pdf' ? buildDiscountPdf(rows, meta) : await buildDiscountExcel(rows, meta)
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
        'X-Export-Count': String(rows.length),
      },
    })
  } catch (error) {
    console.error('Discount approvals export failed:', error)
    return NextResponse.json({ error: 'Could not build the export' }, { status: 500 })
  }
}
