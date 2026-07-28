-- Feed health for Call Analysis.
--
-- WHY: the page reads a synced table, so a broken feed looks exactly like a quiet week. 71% of the
-- call log comes from one handset ("AM HYUNDAI"); if that phone stops uploading, the numbers simply
-- stop growing and nothing on the page says so. `last_synced_at` cannot see it either — OUR sync
-- keeps succeeding, it just has nothing new to fetch.
--
-- Two independent signals, captured on every sync run:
--
--   handsets     — from Callyzer's /employee/get. The only data in their whole API that is NOT
--                  derivable from the call rows: last_sync_req_at (when the phone last checked in),
--                  is_app_uninstalled, is_call_recording_active, app_version, device model.
--                  A handset that has not checked in for hours, or has recording switched off, is
--                  losing data right now.
--
--   completeness — from Callyzer's /call-log/summary. Their own total for a window vs our COUNT(*)
--                  for the same window. Verified to reconcile EXACTLY on closed months
--                  (Jun 2026 398/398, May 2026 216/216), which is what makes a drift meaningful.
--                  This catches a PARTIALLY failed sync — a page that 429'd and was dropped — which
--                  a "last run: ok" status structurally cannot detect.
--
-- jsonb rather than columns: both shapes are small, read whole, never filtered on, and Callyzer may
-- add fields. A column per handset attribute would need a migration every time they do.

ALTER TABLE callyzer_sync_state
  ADD COLUMN IF NOT EXISTS handsets            jsonb,
  ADD COLUMN IF NOT EXISTS handsets_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS completeness        jsonb,
  ADD COLUMN IF NOT EXISTS completeness_checked_at timestamptz;

COMMENT ON COLUMN callyzer_sync_state.handsets IS
  'Array of per-device health from /employee/get: empName, empNumber, tags, appVersion, lastSyncReqAt, lastCallAt, appUninstalled, recordingActive, deviceModel.';
COMMENT ON COLUMN callyzer_sync_state.completeness IS
  'Row-count reconciliation vs /call-log/summary: {windowFrom, windowTo, ours, theirs, delta, byType}.';
