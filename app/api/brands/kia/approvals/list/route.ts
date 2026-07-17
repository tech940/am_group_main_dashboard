import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rows = await db
      .select()
      .from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.brand, 'kia'))
      .orderBy(desc(kiaApprovalRequests.createdAt))

    console.log('Payment Approvals list fetched rows:', rows.length)

    return NextResponse.json({ rows })
  } catch (error) {
    console.error('Error fetching approvals list:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch approvals list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
