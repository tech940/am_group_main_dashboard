-- Alert de-duplication for the Call Analysis feed-health email.
--
-- THE PROBLEM THIS SOLVES: the sync runs every 3 hours. Without state, a handset that stays offline
-- for a week would send 56 identical emails, and the recipients would filter the alert to trash —
-- at which point the one that matters is invisible too. An alarm that cries wolf is worse than none.
--
-- last_alert_signature is a stable fingerprint of the CURRENT problem set (which handsets, in which
-- state, plus any completeness drift). Mail goes out only when the signature CHANGES:
--
--   healthy  -> problem        alert
--   problem  -> other problem  alert (the situation genuinely changed)
--   problem  -> healthy        recovery notice, so nobody is left wondering
--   problem  -> same problem   silent
--
-- Empty string means "healthy", which is also the correct starting state: a first run on a healthy
-- feed sends nothing.

ALTER TABLE callyzer_sync_state
  ADD COLUMN IF NOT EXISTS last_alert_signature text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_alert_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_alert_kind      text;

COMMENT ON COLUMN callyzer_sync_state.last_alert_signature IS
  'Fingerprint of the problem set at the last alert. Empty = healthy. Mail is sent only when this changes.';
COMMENT ON COLUMN callyzer_sync_state.last_alert_kind IS
  'alert | recovery — what was last sent, for the audit trail.';
