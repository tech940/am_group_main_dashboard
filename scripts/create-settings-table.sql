-- Create dashboard_settings table
CREATE TABLE IF NOT EXISTS dashboard_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create index on key for faster lookups
CREATE INDEX IF NOT EXISTS idx_dashboard_settings_key ON dashboard_settings(key);
CREATE INDEX IF NOT EXISTS idx_dashboard_settings_category ON dashboard_settings(category);

-- Insert default settings
INSERT INTO dashboard_settings (key, value, category, description) VALUES
  ('siteName', '"AM Group Dashboard"', 'general', 'Name of the dashboard application'),
  ('siteUrl', '"https://dashboard.amgroup.com"', 'general', 'URL of the dashboard'),
  ('maintenanceMode', 'false', 'general', 'Enable maintenance mode to disable public access'),
  ('allowRegistration', 'false', 'general', 'Allow new user registrations'),
  ('emailNotifications', 'true', 'notifications', 'Enable email notifications'),
  ('smsNotifications', 'false', 'notifications', 'Enable SMS notifications'),
  ('autoBackup', 'true', 'backup', 'Enable automatic backups'),
  ('backupFrequency', '"daily"', 'backup', 'Backup frequency'),
  ('sessionTimeout', '30', 'security', 'Session timeout in minutes'),
  ('maxLoginAttempts', '5', 'security', 'Maximum login attempts before lockout')
ON CONFLICT (key) DO NOTHING;

-- Made with Bob