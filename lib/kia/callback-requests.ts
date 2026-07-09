import 'server-only'

import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaCallbackRequests } from '@/lib/db/schema'

// A customer may only have one open callback request per booking within this window. The public
// page shows an "already received" state and the submit API dedupes, both off this same rule so
// they never disagree.
export const CALLBACK_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The most recent still-pending callback request for a booking within the dedupe window, or null.
 * Once staff mark it contacted/closed (status changes) or the window lapses, the customer may
 * request again.
 */
export async function getRecentPendingCallbackRequest(bookingId: string) {
  const [existing] = await db
    .select({ id: kiaCallbackRequests.id, createdAt: kiaCallbackRequests.createdAt })
    .from(kiaCallbackRequests)
    .where(and(
      eq(kiaCallbackRequests.bookingId, bookingId),
      eq(kiaCallbackRequests.status, 'pending'),
      gte(kiaCallbackRequests.createdAt, new Date(Date.now() - CALLBACK_DEDUPE_WINDOW_MS)),
    ))
    .orderBy(desc(kiaCallbackRequests.createdAt))
    .limit(1)
  return existing || null
}
