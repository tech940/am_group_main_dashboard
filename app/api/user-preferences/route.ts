import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
      // Get all preferences for user
      const preferences = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, appUser.id))

      return NextResponse.json({ preferences })
    }

    // Get specific preference
    const [preference] = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, appUser.id),
          eq(userPreferences.preferenceKey, key)
        )
      )
      .limit(1)

    if (!preference) {
      return NextResponse.json({ preference: null })
    }

    return NextResponse.json({ preference })
  } catch (error) {
    console.error('Error fetching user preferences:', error)
    return NextResponse.json(
      { error: 'Failed to fetch preferences' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { key, value } = body

    if (!key || typeof key !== 'string') {
      return NextResponse.json(
        { error: 'Preference key is required' },
        { status: 400 }
      )
    }

    if (value === undefined) {
      return NextResponse.json(
        { error: 'Preference value is required' },
        { status: 400 }
      )
    }

    // Upsert preference
    const [preference] = await db
      .insert(userPreferences)
      .values({
        userId: appUser.id,
        preferenceKey: key,
        preferenceValue: value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.preferenceKey],
        set: {
          preferenceValue: value,
          updatedAt: new Date(),
        },
      })
      .returning()

    return NextResponse.json({ preference })
  } catch (error) {
    console.error('Error saving user preference:', error)
    return NextResponse.json(
      { error: 'Failed to save preference' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
      return NextResponse.json(
        { error: 'Preference key is required' },
        { status: 400 }
      )
    }

    await db
      .delete(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, appUser.id),
          eq(userPreferences.preferenceKey, key)
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting user preference:', error)
    return NextResponse.json(
      { error: 'Failed to delete preference' },
      { status: 500 }
    )
  }
}

// Made with Bob
