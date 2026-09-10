/**
 * Which KIA booking activity rows count as an "MD / Management Remark".
 *
 * Client-safe — imported by the booking detail panel, the per-booking server count, and the KPI SQL,
 * so the three cannot disagree about what a remark is.
 *
 * ── ⚠️ WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
 * The rule was written THREE times, and every copy decided "is this an MD remark?" by sniffing the
 * ACTOR'S ROLE — `actor_role ILIKE '%md%'` and friends — then trying to subtract system events with a
 * hand-maintained list of title prefixes. The subtraction list never kept up. Measured 2026-09-10:
 * 29 system events by MD/CEO/management/developer accounts were eligible, including
 *   - "Proforma Edited by MD"  — an audit event, which surfaced on a customer's booking as an MD remark
 *     the first time an MD used the new post-approval edit, and had to be deleted by hand;
 *   - "Customer number viewed" — a PII-ACCESS audit record, counted as an MD remark by the server;
 *   - "Discount Approved by CEO", "VIN allocated", "Vehicle delivered", "Booking updated".
 * The three copies also disagreed with each other: the server counted `developer` activity and any
 * actor NAME containing "md"; the panel did neither.
 *
 * The fix is to ask what the row IS, not who wrote it. A remark is a row whose type is a remark.
 *
 * ⚠️ The activity source cannot simply be dropped: real MD remarks ("Why was this cancelled?",
 * "CHECK THE FOLLOW UP DATE") exist ONLY as `remark_added` activity rows — they are not mirrored into
 * kia_bookings.metadata.remarks.
 */
export const KIA_REMARK_ACTIVITY_TYPES = ['remark_added', 'followup_remark'] as const

/** True when an activity row is a human remark rather than a system event. */
export function isKiaRemarkActivityType(type: unknown): boolean {
  return (KIA_REMARK_ACTIVITY_TYPES as readonly string[]).includes(String(type ?? '').trim().toLowerCase())
}

/** SQL literal tuple for raw query text. Compile-time literals only — no caller-supplied values. */
export const KIA_REMARK_ACTIVITY_TYPES_SQL = KIA_REMARK_ACTIVITY_TYPES.map((t) => `'${t}'`).join(', ')
