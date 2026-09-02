import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { kiaApprovalRequests, glAccounts } from '@/lib/db/schema'
import { eq, and, or } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { filterVisibleApprovals } from '@/lib/kia/approval-scope'
import { requirePermission } from '@/lib/permissions/service'
import { INDIA_TIME_ZONE } from '@/lib/date-time'

export async function GET(req: NextRequest) {
  try {
    // ⚠️ This endpoint had NO authentication. An anonymous GET returned a CSV of every fully
    // approved voucher - 49 rows worth Rs 38,06,954 - with amount, vendor, requester name,
    // branch, GST and GL code. There is no middleware covering this path, so the guard has to
    // live here.
    /*
     * ⚠️ NOT `requireBrandApiAccess('kia')`, which is what this used to call.
     *
     * The Approvals section is MULTI-BRAND — Hyundai, Platinum and MG all submit through it, and
     * only the permission key is still named `kia.*` for historical reasons. Hardcoding the KIA
     * brand check meant every non-KIA login 403'd on this endpoint, so Hyundai Accounts and
     * Platinum Accounts could see their MD-approved vouchers on screen and then could not export a
     * single one of them to Tally. Their own brand's payments, refused by a KIA brand gate.
     *
     * The permission gates the SECTION; `filterVisibleApprovals` below already restricts the rows
     * to what this user may see, so a Hyundai login exports Hyundai vouchers and nothing else. That
     * row filter — not the brand of the URL — is what keeps the CSV correctly scoped.
     */
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'kia.approvals.view')
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.reason }, { status: 403 })
    }
    // Fetch all fully approved requests (or you can filter by selectedIds query param)
    const { searchParams } = new URL(req.url)
    const selectedIdsParam = searchParams.get('ids')
    
    let query = db
      .select({
        id: kiaApprovalRequests.id,
        amount: kiaApprovalRequests.amount,
        vendorName: kiaApprovalRequests.vendorName,
        remarks: kiaApprovalRequests.remarks,
        createdAt: kiaApprovalRequests.createdAt,
        name: kiaApprovalRequests.name,
        dealerName: kiaApprovalRequests.dealerName,
        // Selected purely so the branch scope below can be applied — the CSV mapping at rows.map()
        // names its columns explicitly, so these never reach the export.
        brand: kiaApprovalRequests.brand,
        dealerCode: kiaApprovalRequests.dealerCode,
        location: kiaApprovalRequests.location,
        gst: kiaApprovalRequests.gst,
        glCode: glAccounts.glCode,
        glName: glAccounts.glName,
        tallyGroup: glAccounts.tallyGroup,
        accountNature: glAccounts.accountNature,
        accountType: glAccounts.accountType
      })
      .from(kiaApprovalRequests)
      .leftJoin(glAccounts, eq(kiaApprovalRequests.glAccountId, glAccounts.id))
      .where(
        and(
          eq(kiaApprovalRequests.vpApproval, 'APPROVED'),
          eq(kiaApprovalRequests.accountApproval, 'APPROVED'),
          or(
            eq(kiaApprovalRequests.managementApproval, 'APPROVED'),
            eq(kiaApprovalRequests.managementApproval, 'APPROVED') // fallback or simple check
          )
        )
      )

    let rows = await query

    /*
     * Branch scope BEFORE the id filter, so passing explicit ids cannot widen what is exported.
     * This route previously applied no branch check at all: any authenticated user could export
     * every approved voucher in the group as a Tally-ready CSV. See lib/kia/approval-scope.ts.
     */
    rows = filterVisibleApprovals(appUser, rows)

    // If selected IDs were passed, filter down to them
    if (selectedIdsParam) {
      const ids = selectedIdsParam.split(',')
      rows = rows.filter(r => ids.includes(r.id))
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No approved vouchers found to export' }, { status: 404 })
    }

    // Build Tally Journal Vouchers CSV content
    const csvHeaders = [
      'Voucher Date',
      'Voucher Type',
      'Voucher No',
      'Debit Ledger (GL Name)',
      'Debit Code (GL Code)',
      'Debit Amount',
      'Credit Ledger (Vendor)',
      'Credit Amount',
      'Narration',
      'Dealer Branch',
      'GST Details'
    ]

    const csvRows = rows.map(r => {
      /*
       * IST, explicitly. This runs on the SERVER, where there is no browser timezone to inherit —
       * Node uses the host's, which is UTC on Vercel. A bare toLocaleDateString therefore stamped a
       * Tally voucher with the UTC date, so every request created after 18:30 IST exported under the
       * PREVIOUS day and landed in the wrong accounting period.
       */
      const dateStr = new Date(r.createdAt).toLocaleDateString('en-IN', { timeZone: INDIA_TIME_ZONE })
      const debitLedger = r.glName || 'Suspense GL'
      const debitCode = r.glCode || ''
      const creditLedger = r.vendorName || 'Sundry Creditors'
      const amount = r.amount
      const narration = `Payment approved for ${r.name}. Notes: ${r.remarks || '—'}`.replace(/"/g, '""')
      const branch = r.dealerName || ''
      const gst = r.gst || ''

      return [
        `"${dateStr}"`,
        `"Journal"`,
        `"${r.id}"`,
        `"${debitLedger}"`,
        `"${debitCode}"`,
        `${amount}`,
        `"${creditLedger}"`,
        `${amount}`,
        `"${narration}"`,
        `"${branch}"`,
        `"${gst}"`
      ].join(',')
    })

    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n')

    // Return downloadable CSV file attachment
    const response = new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tally_erp_import_vouchers.csv"'
      }
    })

    return response
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to export tally vouchers' }, { status: 500 })
  }
}
