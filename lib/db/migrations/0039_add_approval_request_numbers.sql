-- Per-brand request numbers for payment approvals: KIA_0001, HYUNDAI_0001, PLATINUM_0001.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- The "#" column in the approvals table was a POSITIONAL row index — 1, 2, 3 down the page. It is
-- not an identifier: it changes the moment anyone sorts, filters, pages, or when a new request
-- arrives above it. Two people looking at the same list on different filters see different numbers
-- for the same payment, and nothing on the printed voucher ties back to a row. The only stable
-- handle today is a uuid, which nobody can read down a phone line.
--
-- ── Shape ─────────────────────────────────────────────────────────────────────────────────────
-- <BRAND>_<sequence>, zero-padded to 4 and free to grow past it (KIA_9999 -> KIA_10000).
-- The sequence is PER BRAND, so KIA and Hyundai each start at 1 and neither leaves gaps in the
-- other's run.
--
-- ⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT WRITES IT. The create routes allocate a number on
-- every insert; without the column and the counter table they will fail.
--
-- Migrations here are applied BY HAND. Run `npm run db:backup` first, and use the direct/session
-- port — DDL does not run through the pgbouncer transaction pooler.

-- ── 1. the column ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE kia_approval_requests
  ADD COLUMN IF NOT EXISTS request_no text;

-- ── 2. the per-brand counter ──────────────────────────────────────────────────────────────────
-- A counter table rather than a Postgres sequence per brand: brands are data here (kia, hyundai,
-- platinum, mg and whatever is added next), and CREATE SEQUENCE per brand would mean runtime DDL,
-- which this codebase deliberately removed in migration 0015.
--
-- Allocation is a single atomic statement:
--     INSERT INTO approval_number_counters (brand, next_value) VALUES ($1, 2)
--     ON CONFLICT (brand) DO UPDATE SET next_value = approval_number_counters.next_value + 1
--     RETURNING next_value - 1 AS allocated;
-- so two concurrent submissions can never receive the same number. That matters more than usual
-- here: the create endpoint is intentionally UNAUTHENTICATED public intake, so bursts are possible
-- and nothing upstream serialises them.
CREATE TABLE IF NOT EXISTS approval_number_counters (
  brand       text PRIMARY KEY,
  next_value  integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 3. backfill, in submission order ──────────────────────────────────────────────────────────
-- Ordered by created_at then id so the numbers read as the order requests actually arrived, and so
-- re-running produces the same assignment. Only touches rows that do not already have one.
WITH numbered AS (
  SELECT
    id,
    UPPER(COALESCE(NULLIF(BTRIM(brand), ''), 'kia')) AS brand_key,
    ROW_NUMBER() OVER (
      PARTITION BY UPPER(COALESCE(NULLIF(BTRIM(brand), ''), 'kia'))
      ORDER BY created_at, id
    ) AS seq
  FROM kia_approval_requests
  WHERE request_no IS NULL
)
UPDATE kia_approval_requests r
SET request_no = n.brand_key || '_' || LPAD(n.seq::text, 4, '0')
FROM numbered n
WHERE r.id = n.id;

-- ── 4. seed the counters past the backfill ────────────────────────────────────────────────────
-- next_value must be one MORE than the highest sequence already handed out, or the first live
-- submission would collide with a backfilled row.
INSERT INTO approval_number_counters (brand, next_value)
SELECT
  UPPER(COALESCE(NULLIF(BTRIM(brand), ''), 'kia')) AS brand_key,
  COUNT(*)::int + 1
FROM kia_approval_requests
GROUP BY 1
ON CONFLICT (brand) DO UPDATE
  SET next_value = GREATEST(approval_number_counters.next_value, EXCLUDED.next_value),
      updated_at = now();

-- ── 5. uniqueness, as a backstop ──────────────────────────────────────────────────────────────
-- The counter makes collisions impossible; this makes a bug that bypasses it LOUD rather than
-- silent. Partial, so rows predating the column (none after step 3) do not block it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kia_approval_requests_request_no
  ON kia_approval_requests (request_no)
  WHERE request_no IS NOT NULL;

-- The approvals list sorts by created_at DESC and now displays request_no; this keeps the lookup
-- cheap when someone searches for a specific number.
CREATE INDEX IF NOT EXISTS idx_kia_approval_requests_request_no_lookup
  ON kia_approval_requests (UPPER(request_no));

ANALYZE kia_approval_requests;
