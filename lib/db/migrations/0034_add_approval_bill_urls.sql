-- Approvals: one bill upload that accepts many bills.
--
-- The submit form used to have two fixed bill slots, so the table has two flat columns. Submitters
-- routinely have more than two bills for one payment and had nowhere to put the third.
--
-- `bill_urls` holds the full ordered list. `upload_bill_url_1` / `upload_bill_url_2` are KEPT and
-- keep being written with the first two entries, because the approver UI, the notification emails
-- and the printed payment voucher all read those columns directly — dropping them would hide
-- bills from the people approving the money.
--
-- Existing rows get their two legacy URLs backfilled into the array so old and new requests render
-- through the same code path.

ALTER TABLE kia_approval_requests
  ADD COLUMN IF NOT EXISTS bill_urls jsonb DEFAULT '[]'::jsonb NOT NULL;

UPDATE kia_approval_requests
SET bill_urls = (
  SELECT COALESCE(jsonb_agg(url), '[]'::jsonb)
  FROM (
    SELECT upload_bill_url_1 AS url WHERE upload_bill_url_1 IS NOT NULL AND upload_bill_url_1 <> ''
    UNION ALL
    SELECT upload_bill_url_2 WHERE upload_bill_url_2 IS NOT NULL AND upload_bill_url_2 <> ''
  ) AS legacy
)
WHERE bill_urls = '[]'::jsonb
  AND (
    (upload_bill_url_1 IS NOT NULL AND upload_bill_url_1 <> '')
    OR (upload_bill_url_2 IS NOT NULL AND upload_bill_url_2 <> '')
  );
