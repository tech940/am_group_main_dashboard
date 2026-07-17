import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { approvalsCommonData } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    await db
      .delete(approvalsCommonData)
      .where(eq(approvalsCommonData.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting vendor:', error)
    return NextResponse.json(
      { error: 'Failed to delete vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const { name } = body

    if (!name?.trim()) return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })

    const [updated] = await db
      .update(approvalsCommonData)
      .set({
        value: name.trim(),
      })
      .where(eq(approvalsCommonData.id, id))
      .returning()

    return NextResponse.json({
      success: true,
      vendor: {
        id: updated.id,
        name: updated.value,
        gstNumber: ''
      }
    })
  } catch (error) {
    console.error('Error updating vendor:', error)
    return NextResponse.json(
      { error: 'Failed to update vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
