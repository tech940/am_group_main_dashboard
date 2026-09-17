import { after } from 'next/server'
import { actorOf, HPromiseError, requireHPromiseApi } from '@/lib/h-promise/access'
import { hPromiseErrorResponse, hpJson } from '@/lib/h-promise/api'
import { HP_MAX_FILE_BYTES } from '@/lib/h-promise/constants'
import { stageUpload, sweepStaleStagedFiles } from '@/lib/h-promise/files'
import { uploadKindSchema } from '@/lib/h-promise/schemas'

export const dynamic = 'force-dynamic'
/** Image optimisation plus a storage upload. */
export const maxDuration = 60

/**
 * ONE file per request (Vercel refuses bodies over 4.5 MB; the browser compresses photos first).
 * The file is checked by its content, stored privately, and waits unattached until the form that uses it is
 * saved. Whether this person may upload this KIND is decided inside stageUpload.
 */
export async function POST(request: Request) {
  const access = await requireHPromiseApi((caps) => caps.register.create || caps.register.edit || caps.payments.edit)
  if (access.denied) return access.denied
  try {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new HPromiseError('The upload did not arrive. Try again.', 400)
    }
    const kind = uploadKindSchema.parse(form.get('kind'))
    const file = form.get('file')
    if (!(file instanceof File)) throw new HPromiseError('Choose a file to upload.', 400)
    if (file.size === 0) throw new HPromiseError('That file is empty.', 400)
    if (file.size > HP_MAX_FILE_BYTES) throw new HPromiseError('That file is larger than 10 MB.', 413)
    const bytes = Buffer.from(await file.arrayBuffer())
    const result = await stageUpload({
      actor: actorOf(access.appUser),
      caps: access.caps,
      kind,
      bytes,
      originalName: file.name || null,
    })
    after(() => sweepStaleStagedFiles().catch((error) => console.error('[h-promise] staged-file sweep failed:', error)))
    return hpJson(result, { status: 201 })
  } catch (error) {
    return hPromiseErrorResponse(error)
  }
}
