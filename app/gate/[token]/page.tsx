import { buildGuardView } from '@/lib/gate-pass/guard-view'
import { verifyGateToken } from '@/lib/gate-pass/token'
import { GuardForm } from '@/features/gate-pass/guard-form'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC page — no login, deliberately. Security guards have no dashboard accounts, so the signed
 * token in the URL is the credential. Same posture as app/track/[token].
 *
 * noindex/nofollow: this URL grants an action. It must never appear in a search index.
 */
export const metadata = {
  title: 'Gate Pass | AM Group',
  robots: { index: false, follow: false },
}

export default async function GatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = verifyGateToken(token, new Date())

  if (!verified.ok) {
    return <Invalid reason={verified.reason} />
  }

  const pass = await buildGuardView(verified.passId, verified.purpose)
  if (!pass) return <Invalid reason="malformed" />

  return <GuardForm pass={pass} token={token} />
}

/**
 * One page for every failure. An expired link says so, because that is actionable for a guard
 * standing at a barrier; a bad signature does not, because that is someone probing.
 */
function Invalid({ reason }: { reason: 'malformed' | 'bad_signature' | 'expired' }) {
  const expired = reason === 'expired'
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">
        {expired ? 'This gate pass has expired' : 'This link is not valid'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {expired
          ? 'Ask the driver to get a fresh pass from the showroom before releasing the vehicle.'
          : 'Scan the QR code on the gate pass again. If it still fails, check with the showroom.'}
      </p>
    </div>
  )
}
