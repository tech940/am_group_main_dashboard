# Dashboard Settings System - Setup Guide

## Overview
The Dashboard Settings system allows admins to configure various aspects of the application including general settings, security, notifications, and backups. All settings are stored in the database and persist across sessions.

## Setup Instructions

### Step 1: Create the Settings Table

Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor):

```sql
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

-- Create indexes
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
```

Or run the SQL file:
```bash
# Copy the contents of scripts/create-settings-table.sql and run in Supabase SQL Editor
```

### Step 2: Test the Settings

1. **Login as Admin**
   - Email: `admin@amgroup.com`
   - Password: `Admin@123456`

2. **Navigate to Settings**
   - Go to Admin Panel > Dashboard Settings
   - You should see all settings loaded from the database

3. **Modify Settings**
   - Change any setting (e.g., Site Name, Session Timeout)
   - Click "Save Changes"
   - Refresh the page to verify settings persist

## Available Settings

### General Settings
- **Site Name**: Name displayed in the dashboard
- **Site URL**: Base URL of the application
- **Maintenance Mode**: Disable public access for maintenance
- **Allow Registration**: Enable/disable new user signups

### Security Settings
- **Session Timeout**: Minutes before auto-logout (default: 30)
- **Max Login Attempts**: Failed attempts before lockout (default: 5)
- **Two-Factor Authentication**: Configure 2FA (coming soon)

### Notification Settings
- **Email Notifications**: Receive updates via email
- **SMS Notifications**: Receive alerts via SMS

### Backup & Recovery
- **Automatic Backup**: Enable scheduled backups
- **Backup Frequency**: How often to backup (daily/weekly/monthly)
- **Create Backup Now**: Manual backup trigger
- **Restore from Backup**: Restore from previous backup

## API Endpoints

### GET /api/admin/settings
Fetch all settings as a key-value object.

**Response:**
```json
{
  "siteName": "AM Group Dashboard",
  "siteUrl": "https://dashboard.amgroup.com",
  "maintenanceMode": false,
  "allowRegistration": false,
  "emailNotifications": true,
  "smsNotifications": false,
  "autoBackup": true,
  "backupFrequency": "daily",
  "sessionTimeout": 30,
  "maxLoginAttempts": 5
}
```

### PUT /api/admin/settings
Update settings (Admin only).

**Request:**
```json
{
  "settings": {
    "siteName": "New Dashboard Name",
    "sessionTimeout": 60,
    "emailNotifications": false
  }
}
```

**Response:**
```json
{
  "message": "Settings updated successfully"
}
```

## Database Schema

```typescript
export const dashboardSettings = pgTable('dashboard_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  value: jsonb('value').notNull(),
  category: text('category').notNull(),
  description: text('description'),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

## Adding New Settings

### 1. Add to Database
```sql
INSERT INTO dashboard_settings (key, value, category, description) 
VALUES ('newSetting', '"default value"', 'general', 'Description of setting');
```

### 2. Add to Frontend State
Update `app/admin/settings/page.tsx`:
```typescript
const [settings, setSettings] = useState({
  // ... existing settings
  newSetting: 'default value',
})
```

### 3. Add UI Component
Add input field in the appropriate settings card:
```tsx
<div className="space-y-2">
  <Label htmlFor="newSetting">New Setting</Label>
  <Input
    id="newSetting"
    value={settings.newSetting}
    onChange={(e) => setSettings({ ...settings, newSetting: e.target.value })}
    className="rounded-xl border-slate-200"
  />
</div>
```

## Security Notes

- ✅ Only admin users can modify settings
- ✅ All changes are logged with user ID
- ✅ Settings are validated on the backend
- ✅ JSONB storage allows flexible data types
- ✅ Timestamps track when settings were changed

## Troubleshooting

### Settings not loading
- Check if the table exists: `SELECT * FROM dashboard_settings;`
- Verify user is logged in and has admin role
- Check browser console for API errors

### Settings not saving
- Ensure user has admin role
- Check API response for error messages
- Verify database connection is working

### Default settings missing
- Run the INSERT statements from Step 1 again
- Check for conflicts with existing keys

## Future Enhancements

- [ ] Settings history/audit log
- [ ] Settings import/export
- [ ] Settings validation rules
- [ ] Settings categories management
- [ ] Role-based settings access
- [ ] Settings search and filter
- [ ] Settings backup/restore
- [ ] Settings versioning

## Made with Bob