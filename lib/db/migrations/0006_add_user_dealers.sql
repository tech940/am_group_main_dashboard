-- Per-user dealer/branch scope within a brand. Comma-separated dealer codes (e.g. 'JK402' for
-- KIA Jammu, 'JK501' for Udhampur; 'JAMMU'/'AKHNOOR'/... for Hyundai; 'N5211'/... for Platinum).
-- NULL means the user can see every branch of their brand (the previous behavior), so this is
-- backward-compatible: existing users are unaffected until an admin assigns a branch.

ALTER TABLE users ADD COLUMN IF NOT EXISTS dealers text;
