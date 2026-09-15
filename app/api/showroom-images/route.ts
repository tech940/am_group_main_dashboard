import { NextRequest, NextResponse } from 'next/server'
import { getShowroomGallerySessions, deleteShowroomSession } from '@/lib/showroom-images/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const brand = searchParams.get('brand') || undefined
    const location = searchParams.get('location') || undefined
    const department = searchParams.get('department') || undefined
    const category = searchParams.get('category') || undefined
    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 50

    const data = await getShowroomGallerySessions({
      brand,
      location,
      department,
      category,
      startDate,
      endDate,
      limit: Number.isNaN(limit) ? 50 : limit,
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching showroom images:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch showroom images.' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const result = await deleteShowroomSession(sessionId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error deleting showroom session:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete showroom session.' },
      { status: 500 }
    )
  }
}

