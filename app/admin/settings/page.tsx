'use client'

import { useCallback, useEffect, useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Settings,
  Database,
  Bell,
  Shield,
  Globe,
  Save,
  RefreshCw,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export default function AdminSettingsPage() {
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState({
    siteName: 'AM Group Dashboard',
    siteUrl: 'https://dashboard.amgroup.com',
    maintenanceMode: false,
    allowRegistration: false,
    emailNotifications: true,
    smsNotifications: false,
    autoBackup: true,
    backupFrequency: 'daily',
    sessionTimeout: 30,
    maxLoginAttempts: 5,
  })

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/settings')
      if (response.ok) {
        const data = await response.json()
        // Merge fetched settings with defaults
        setSettings(prev => ({ ...prev, ...data }))
      }
    } catch (error) {
      console.error('Error fetching settings:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      })

      if (response.ok) {
        alert('Settings saved successfully!')
      } else {
        const error = await response.json()
        alert(`Error: ${error.error || 'Failed to save settings'}`)
      }
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <MainLayout title="Dashboard Settings" subtitle="Admin Panel">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-teal-600 mx-auto mb-4" />
            <p className="text-slate-600 font-semibold">Loading settings...</p>
          </div>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout title="Dashboard Settings" subtitle="Admin Panel">
      <div className="space-y-6 max-w-[1400px] mx-auto animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-800">Dashboard Settings</h1>
            <p className="text-slate-500 mt-2 font-semibold">Configure and control your dashboard</p>
          </div>
          
          <Button 
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white shadow-lg shadow-teal-500/30 rounded-xl font-bold"
          >
            {saving ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>

        {/* System Status */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">System Status</p>
                  <Badge className="mt-2 bg-emerald-100 text-emerald-700 rounded-lg font-bold">
                    Operational
                  </Badge>
                </div>
                <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Database className="h-6 w-6 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Database</p>
                  <p className="text-2xl font-black text-slate-800 mt-2">99.9%</p>
                  <p className="text-xs text-slate-500 font-semibold">Uptime</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-teal-50 flex items-center justify-center">
                  <Database className="h-6 w-6 text-teal-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">API Status</p>
                  <Badge className="mt-2 bg-emerald-100 text-emerald-700 rounded-lg font-bold">
                    Active
                  </Badge>
                </div>
                <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Globe className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Last Backup</p>
                  <p className="text-sm font-black text-slate-800 mt-2">2 hours ago</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <RefreshCw className="h-6 w-6 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* General Settings */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center">
                  <Settings className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <CardTitle className="text-xl font-black text-slate-800">General Settings</CardTitle>
                  <CardDescription className="text-slate-500 font-semibold">Basic configuration options</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="siteName" className="text-sm font-bold text-slate-700">Site Name</Label>
                <Input
                  id="siteName"
                  value={settings.siteName}
                  onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                  className="rounded-xl border-slate-200"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="siteUrl" className="text-sm font-bold text-slate-700">Site URL</Label>
                <Input
                  id="siteUrl"
                  value={settings.siteUrl}
                  onChange={(e) => setSettings({ ...settings, siteUrl: e.target.value })}
                  className="rounded-xl border-slate-200"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">Maintenance Mode</p>
                    <p className="text-xs text-slate-500 font-semibold">Disable public access</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.maintenanceMode}
                  onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                  className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="text-sm font-bold text-slate-800">Allow Registration</p>
                  <p className="text-xs text-slate-500 font-semibold">Enable new user signups</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.allowRegistration}
                  onChange={(e) => setSettings({ ...settings, allowRegistration: e.target.checked })}
                  className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </div>
            </CardContent>
          </Card>

          {/* Security Settings */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <CardTitle className="text-xl font-black text-slate-800">Security Settings</CardTitle>
                  <CardDescription className="text-slate-500 font-semibold">Authentication and access control</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="sessionTimeout" className="text-sm font-bold text-slate-700">Session Timeout (minutes)</Label>
                <Input
                  id="sessionTimeout"
                  type="number"
                  value={settings.sessionTimeout}
                  onChange={(e) => setSettings({ ...settings, sessionTimeout: parseInt(e.target.value) })}
                  className="rounded-xl border-slate-200"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="maxLoginAttempts" className="text-sm font-bold text-slate-700">Max Login Attempts</Label>
                <Input
                  id="maxLoginAttempts"
                  type="number"
                  value={settings.maxLoginAttempts}
                  onChange={(e) => setSettings({ ...settings, maxLoginAttempts: parseInt(e.target.value) })}
                  className="rounded-xl border-slate-200"
                />
              </div>

              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">Two-Factor Authentication</p>
                    <p className="text-xs text-slate-600 font-semibold mt-1">Enhance security with 2FA for all admin accounts</p>
                    <Button size="sm" className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
                      Configure 2FA
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Bell className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-xl font-black text-slate-800">Notifications</CardTitle>
                  <CardDescription className="text-slate-500 font-semibold">Configure notification preferences</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="text-sm font-bold text-slate-800">Email Notifications</p>
                  <p className="text-xs text-slate-500 font-semibold">Receive updates via email</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.emailNotifications}
                  onChange={(e) => setSettings({ ...settings, emailNotifications: e.target.checked })}
                  className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="text-sm font-bold text-slate-800">SMS Notifications</p>
                  <p className="text-xs text-slate-500 font-semibold">Receive alerts via SMS</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.smsNotifications}
                  onChange={(e) => setSettings({ ...settings, smsNotifications: e.target.checked })}
                  className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </div>
            </CardContent>
          </Card>

          {/* Backup Settings */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Database className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <CardTitle className="text-xl font-black text-slate-800">Backup & Recovery</CardTitle>
                  <CardDescription className="text-slate-500 font-semibold">Data backup configuration</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="text-sm font-bold text-slate-800">Automatic Backup</p>
                  <p className="text-xs text-slate-500 font-semibold">Enable scheduled backups</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoBackup}
                  onChange={(e) => setSettings({ ...settings, autoBackup: e.target.checked })}
                  className="h-5 w-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-3">
                <Button className="w-full bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-xl font-bold">
                  <Database className="mr-2 h-4 w-4" />
                  Create Backup Now
                </Button>
                <Button variant="outline" className="w-full rounded-xl font-bold border-slate-200">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Restore from Backup
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  )
}

// Made with Bob
