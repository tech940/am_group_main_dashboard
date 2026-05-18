import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { dashboardSettings } from '@/lib/db/schema'

function canAccessAdminPanel(role: string | null | undefined) {
  return role === 'admin' || role === 'md'
}

export async function GET() {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser || !canAccessAdminPanel(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const settings = await db.select().from(dashboardSettings)
    const settingsObject = settings.reduce<Record<string, unknown>>((accumulator, setting) => {
      accumulator[setting.key] = setting.value
      return accumulator
    }, {})

    return NextResponse.json(settingsObject)
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser || !canAccessAdminPanel(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { settings: newSettings } = body as { settings?: Record<string, unknown> }

    if (!newSettings || typeof newSettings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 })
    }

    for (const [key, value] of Object.entries(newSettings)) {
      const existing = await db
        .select()
        .from(dashboardSettings)
        .where(eq(dashboardSettings.key, key))
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(dashboardSettings)
          .set({
            value,
            updatedBy: appUser.id,
            updatedAt: new Date(),
          })
          .where(eq(dashboardSettings.key, key))
      } else {
        await db.insert(dashboardSettings).values({
          key,
          value,
          category: getCategoryForKey(key),
          updatedBy: appUser.id,
        })
      }
    }

    return NextResponse.json({ message: 'Settings updated successfully' })
  } catch (error) {
    console.error('Error updating settings:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}

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
