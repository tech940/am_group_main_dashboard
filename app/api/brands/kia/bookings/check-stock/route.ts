import { NextResponse } from 'next/server'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { countKiaMatchingStock } from '@/lib/kia/bookings'

export const dynamic = 'force-dynamic'

/**
 * "Is this model + variant + colour in stock?" for the booking form.
 *
 * ⚠️ THIS ROUTE WAS THE SEVENTH COPY OF THE STOCK MATCH, and the only one never migrated when the
 * other six were consolidated into `kiaMatchingStockExists`. Two defects, both user-visible:
 *
 *   1. It never read `model`. The form has always SENT it (kia-bookings-client.tsx), and this
 *      handler read only `variant` and `color` — so a Seltos GTX in white counted as available
 *      stock for a Sonet GTX in white, and the form said "IN STOCK".
 *   2. Its only other condition was `va.id IS NULL`. No `stock_status` allowlist, no retail/hold
 *      exclusion, no check for cars we had already delivered — so it counted vehicles the Allot
 *      picker would never offer.
 *
 * The count under the form was therefore both wrong and LOOSER than the in-stock badge on the same
 * booking's row, which is the disagreement the consolidation was meant to end. It now calls the one
 * shared definition, so the form, the badge, the tab filter and the picker cannot diverge again.
 */
export async function GET(request: Request) {
  const accessError = await requireBrandSectionApiAccess('kia', 'kia.bookings.view')
  if (accessError) return accessError
  try {
    const url = new URL(request.url)
    const model = url.searchParams.get('model') || ''
    const variant = url.searchParams.get('variant') || ''
    const color = url.searchParams.get('color') || ''

    const count = await countKiaMatchingStock(model, variant, color)
    return NextResponse.json({ available: count > 0, count })
  } catch (error) {
    console.error('Failed to check stock:', error)
    return NextResponse.json({ available: false, count: 0, error: String(error) })
  }
}
