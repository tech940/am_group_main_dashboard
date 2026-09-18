import { NextRequest, NextResponse } from 'next/server'
import { createVehicleEvaluation, EvaluationError } from '@/lib/evaluation/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await createVehicleEvaluation(body)
    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error: any) {
    if (error instanceof EvaluationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status },
      )
    }
    console.error('[API evaluations/submit] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process evaluation request. Please try again.' },
      { status: 500 },
    )
  }
}
