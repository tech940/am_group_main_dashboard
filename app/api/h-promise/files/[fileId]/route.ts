import { NextResponse } from 'next/server'
import { actorOf, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse } from '@/lib/h-promise/api'
import { openFile } from '@/lib/h-promise/files'
import { assertVehicleId } from '@/lib/h-promise/queries'

export const dynamic = 'force-dynamic'

/**
 * Opens one stored file through a 5-minute signed URL. Identity documents and the ledger open only for the
 * people allowed to see them, and each opening is written to the vehicle's history.
 * `?download=1` asks the browser to save it instead of showing it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const access = await requireHPromiseApi((caps) => caps.anyView || caps.register.create || caps.payments.edit)
  if (access.denied) return access.denied
  try {
    const { fileId } = await params
    assertVehicleId(fileId)
    const download = new URL(request.url).searchParams.get('download') === '1'
    const url = await openFile(actorOf(access.appUser), access.caps, fileId, download)
    const response = NextResponse.redirect(url, 302)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
