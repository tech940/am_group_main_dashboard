import { NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaPriceDetails } from '@/lib/db/schema'
import { normalizeBankName } from '@/lib/kia/bank-utils'
import { requirePermission } from '@/lib/permissions/service'
import { invalidateCache } from '@/lib/redis/cache-utils'

/**
 * Add a financier branch to the KIA bank lookup, from the screen the user is already on.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * The branch list is a fixed import from the PRICE DETAILS sheet, so every new branch — a bank
 * opening a rural sub-office, a customer financing through somewhere not in the sheet — needed a
 * developer to run scripts/kia-add-bank-branch.ts. Finance, the proforma and the booking form all
 * read the same list, so the person blocked was always the one who could see the problem and never
 * the one who could fix it.
 *
 * ── One row serves all three screens ──────────────────────────────────────────────────────────
 * There is no bank table. The list lives as marker rows in `kia_price_details` under
 * `model = '__BANK_OPTION__'` with every price column zeroed, and /options keeps any row carrying
 * both a bank name and a branch. So a single insert appears in Finance, the proforma and the
 * booking form at once — there is no enum and no hardcoded list to keep in step.
 *
 * ⚠️ The comment in the options route calls the marker `__BANK_BRANCH__`. Nothing in the database
 * uses that string; the real one is `__BANK_OPTION__`. Trust the data, not the comment.
 *
 * ── ⚠️ THIS is why the endpoint exists rather than just the script ────────────────────────────
 * There are two cache tiers. Redis is shared, but `getCachedData` also keeps an in-PROCESS L1 Map
 * that it checks BEFORE Redis and never re-checks while fresh — for the full 30-minute TTL. The
 * CLI script is its own Node process, so it clears its own empty L1 and the shared Redis, and the
 * running web server keeps serving the old list from memory for up to half an hour. A correct write
 * that does not show up is indistinguishable from a failed one.
 *
 * Running the invalidation HERE clears the L1 of the process that serves the request, so the branch
 * is selectable immediately.
 *
 * ⚠️ Multi-instance caveat: other server instances keep their own L1 until it expires. On a single
 * instance this is immediate; behind several, a branch can take up to the TTL to reach everyone.
 * That is why the response says "available to you now" rather than promising it to everybody.
 */

export const dynamic = 'force-dynamic'

/** Both keys: the proforma/booking dropdowns read the first, Finance reads the second. */
const BANK_CACHE_KEYS = ['kia:proforma:options:data', 'finance:bank-options'] as const

const MAX_LEN = 120

export async function POST(request: Request) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    /*
     * Gated on the same permission that lets someone SEE the list. Anyone who can open the proforma
     * can already read every branch; being able to append one is a smaller step than it looks, and
     * a narrower gate would put the block back on the people this is meant to unblock.
     */
    const permission = await requirePermission(appUser, 'kia.proforma.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const bankName = normalizeBankName(String(body?.bankName ?? '').trim())
    // NOT normalised — the branch is displayed verbatim, so it is stored exactly as typed.
    const bankBranch = String(body?.bankBranch ?? '').trim().replace(/\s+/g, ' ')

    if (!bankName) return NextResponse.json({ error: 'Pick a bank first.' }, { status: 400 })
    if (!bankBranch) return NextResponse.json({ error: 'Enter a branch name.' }, { status: 400 })
    if (bankName.length > MAX_LEN || bankBranch.length > MAX_LEN) {
      return NextResponse.json({ error: `Bank and branch must each be under ${MAX_LEN} characters.` }, { status: 400 })
    }

    /*
     * Idempotent, case-insensitively. Two people adding "Arli Katra" and "ARLI KATRA" minutes apart
     * would otherwise produce two entries that look identical in a dropdown, and nobody would know
     * which one previous proformas used.
     */
    const [existing] = await db
      .select({ id: kiaPriceDetails.id, branch: kiaPriceDetails.bankBranch })
      .from(kiaPriceDetails)
      .where(and(
        eq(kiaPriceDetails.model, '__BANK_OPTION__'),
        sql`UPPER(BTRIM(${kiaPriceDetails.bankName})) = ${bankName.toUpperCase()}`,
        sql`UPPER(BTRIM(${kiaPriceDetails.bankBranch})) = ${bankBranch.toUpperCase()}`,
      ))
      .limit(1)

    if (existing) {
      return NextResponse.json({
        ok: true,
        alreadyExisted: true,
        bankName,
        // Return the STORED spelling, so the form selects the row that already exists rather than
        // holding a near-identical string that matches nothing in the list.
        bankBranch: existing.branch || bankBranch,
        message: 'That branch was already on the list.',
      })
    }

    /*
     * Shaped exactly like the imported marker rows and like scripts/kia-add-bank-branch.ts — a row
     * added here must be indistinguishable from one that came off the sheet, or the two ways of
     * adding a branch would drift.
     *
     * `trimDescription` is NOT NULL and the sheet concatenates the pair ("BOB BOB GANDHI NAGAR");
     * `hyp` mirrors the bank because /options falls back to it when bankName is blank. The metadata
     * records that a person added this from a screen, which is the only way to tell later.
     */
    await db.insert(kiaPriceDetails).values({
      model: '__BANK_OPTION__',
      trimDescription: `${bankName} ${bankBranch}`,
      hyp: bankName,
      bankName,
      bankBranch,
      metadata: {
        lookupType: 'bank_branch',
        sourceSheet: 'manual-ui',
        addedBy: appUser.email,
        addedAt: new Date().toISOString(),
      },
    })

    // Inside the request process, so this server's L1 is cleared too — see the note above.
    await Promise.all(BANK_CACHE_KEYS.map((key) => invalidateCache(key)))

    console.info('[kia/proforma/options/branch] added "%s" / "%s" by %s', bankName, bankBranch, appUser.email)

    return NextResponse.json({
      ok: true,
      alreadyExisted: false,
      bankName,
      bankBranch,
      message: `${bankBranch} added and available to you now.`,
    })
  } catch (error) {
    console.error('Error in POST /api/brands/kia/proforma/options/branch:', error)
    return NextResponse.json({ error: 'Could not add the branch.' }, { status: 500 })
  }
}
