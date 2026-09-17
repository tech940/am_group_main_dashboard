import { verifyWalkInToken } from '@/lib/kia/walk-in-leads/link'
import { readWalkInBody, walkInErrorResponse, walkInJson } from '@/lib/kia/walk-in-leads/api'
import { walkInSubmitSchema } from '@/lib/kia/walk-in-leads/schemas'
import { createWalkInLead } from '@/lib/kia/walk-in-leads/server'

export const dynamic = 'force-dynamic'

/**
 * ⚠️ DELIBERATELY PUBLIC — showroom staff fill the Walk-in form WITHOUT a dashboard login (the owner's
 * request, like Showroom Images). Do NOT add a session check: it would lock every sender out. See memory
 * kia-approvals-public-intake for the time that happened.
 *
 * What protects it instead:
 *   - the signed link: no valid `wi1.<branch>.<signature>` token → 404, and the token decides the branch;
 *   - a 16 KB body cap, read before parsing;
 *   - the same schema the form runs (10-digit mobile, known model and source, dates in range, lengths);
 *   - a honeypot field bots fill and people never see;
 *   - a double-submit guard and a per-link flood limit, in the insert statement itself (lib/…/server.ts).
 * It returns only an id — never any stored lead.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = verifyWalkInToken(token)
  if (!link.ok) return walkInJson({ error: 'This form link is not valid. Ask the showroom for the current link.' }, 404)
  try {
    const body = await readWalkInBody(request)
    // A filled honeypot is a bot: answer as if it worked, store nothing, teach it nothing.
    if (body && typeof body === 'object' && String((body as { website?: unknown }).website ?? '').trim()) {
      return walkInJson({ ok: true, id: crypto.randomUUID(), duplicate: false }, 201)
    }
    const input = walkInSubmitSchema.parse(body)
    const result = await createWalkInLead(link.dealerCode, input)
    return walkInJson({ ok: true, id: result.id, duplicate: result.duplicate }, result.duplicate ? 200 : 201)
  } catch (error) {
    return walkInErrorResponse(error)
  }
}
