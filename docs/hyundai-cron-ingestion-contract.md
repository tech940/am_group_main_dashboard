# Hyundai cron ingestion contract

Apply this contract before running Hyundai RO Billing, Repair Order, or Operation Wise imports.

## Dealer normalization

- `N5203 → N5216`
- `N5701 → N6844`
- `N5804 → N6845`
- `N6815 → N6846`
- `N6819 → N6847`
- `N6826/N6828 → N6848`

Do not delete a dealer code merely because it is not in the current UI registry. Stage it and fail reconciliation for review.

## Row identity

`row_hash` is an exact normalized source-row fingerprint, not a bill number, RO number, operation code, or other reusable identifier.

1. Normalize dealer-code fields.
2. Remove database `id`, existing `row_hash`, and `uploaded_at`.
3. Serialize the remaining complete row with stable key ordering.
4. Calculate lowercase SHA-256 hex.
5. Upsert on `row_hash`.

The database triggers recompute this fingerprint, so cron-provided hashes are advisory only.

## Required reconciliation

Before replacing or deleting source data:

- Compare staged and active row counts by dealer and month.
- Compare RO Billing labour, parts, and labour-plus-parts revenue.
- Compare Repair Order min/max dates and status counts.
- Compare Operation Wise `SUM(total_count)` and `SUM(total_amt)` by dealer, period, and operation code.
- Fail the run if historical coverage shrinks, a dealer disappears, or revenue declines without an explicit approved correction.

Never truncate an active table until the staged reconciliation passes and a timestamped backup exists.
