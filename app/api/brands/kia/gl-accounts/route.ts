import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { glAccounts } from '@/lib/db/schema'
import { asc, eq, or } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rows = await db
      .select()
      .from(glAccounts)
      .where(
        or(
          eq(glAccounts.appliesTo, 'both'),
          eq(glAccounts.appliesTo, 'kia')
        )
      )
      .orderBy(asc(glAccounts.glCode))

    return NextResponse.json({ rows })
  } catch (error) {
    console.error('Error fetching GL accounts:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch GL accounts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
