import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { dashboardSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// GET - Fetch all settings
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all settings
    const settings = await db.select().from(dashboardSettings)

    // Convert to key-value object
    const settingsObject = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value
      return acc
    }, {} as Record<string, any>)

    return NextResponse.json(settingsObject)
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT - Update settings
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('supabase_id', user.id)
      .single()

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { settings: newSettings } = body

    if (!newSettings || typeof newSettings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 })
    }

    // Get user's database ID
    const { data: userRecord } = await supabase
      .from('users')
      .select('id')
      .eq('supabase_id', user.id)
      .single()

    // Update each setting
    for (const [key, value] of Object.entries(newSettings)) {
      // Check if setting exists
      const existing = await db
        .select()
        .from(dashboardSettings)
        .where(eq(dashboardSettings.key, key))
        .limit(1)

      if (existing.length > 0) {
        // Update existing setting
        await db
          .update(dashboardSettings)
          .set({
            value: value as any,
            updatedBy: userRecord?.id,
            updatedAt: new Date(),
          })
          .where(eq(dashboardSettings.key, key))
      } else {
        // Insert new setting
        const category = getCategoryForKey(key)
        await db.insert(dashboardSettings).values({
          key,
          value: value as any,
          category,
          updatedBy: userRecord?.id,
        })
      }
    }

    return NextResponse.json({ message: 'Settings updated successfully' })
  } catch (error) {
    console.error('Error updating settings:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}

// Helper function to determine category based on key
function getCategoryForKey(key: string): string {
  if (key.includes('site') || key.includes('maintenance') || key.includes('registration')) {
    return 'general'
  }
  if (key.includes('session') || key.includes('login') || key.includes('security')) {
    return 'security'
  }
  if (key.includes('notification') || key.includes('email') || key.includes('sms')) {
    return 'notifications'
  }
  if (key.includes('backup')) {
    return 'backup'
  }
  return 'general'
}

// Made with Bob