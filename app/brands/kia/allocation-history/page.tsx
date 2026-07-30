import { permanentRedirect } from 'next/navigation'

/**
 * Vehicle Allocation History moved INSIDE Bookings — it is now a tab in the Kia Proforma shell
 * (/brands/kia/proforma/allocation-history), where it sits next to the Booking CRM whose
 * allocations it audits.
 *
 * This route stays only so links and bookmarks to the old standalone page keep working. No auth
 * check here on purpose: the destination runs the real guard (kia.allocation_history.view), and
 * duplicating it would mean two places to keep in sync. A redirect leaks nothing.
 */
export default function KiaAllocationHistoryRedirect(): never {
  permanentRedirect('/brands/kia/proforma/allocation-history')
}
