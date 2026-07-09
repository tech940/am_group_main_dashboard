import type { Metadata } from 'next'
import { getTrackingView, verifyTrackingToken } from '@/lib/kia/tracking'
import { getRecentPendingCallbackRequest } from '@/lib/kia/callback-requests'
import { CallbackRequestForm } from '@/features/kia/callback-request-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Request a Callback · AM Kia',
  robots: { index: false, follow: false },
}

const BRAND = 'AM Kia'
const ACCENT = '#4f46e5'

function NotFound() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 24, border: '1px solid #e2e8f0', padding: 32, textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.02), 0 8px 10px -6px rgba(0,0,0,0.02)' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT }}>{BRAND}</div>
        <h1 style={{ margin: '16px 0 8px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Link not found</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#64748b' }}>
          This link is invalid or has expired. Please contact your sales consultant for an up-to-date link.
        </p>
      </div>
    </main>
  )
}

function AlreadyRequested({ firstName }: { firstName: string }) {
  return (
    <div style={{ padding: '32px', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(79,70,229,0.1)', color: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, margin: '0 auto' }}>✓</div>
      <h2 style={{ margin: '16px 0 6px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>We&apos;ve already received your request</h2>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#64748b' }}>
        Thanks, {firstName}. Our team has your callback request and will reach out to you soon — there&apos;s no need to submit it again.
      </p>
    </div>
  )
}

export default async function CallbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await getTrackingView(token)
  if (!view) return <NotFound />

  const bookingId = verifyTrackingToken(token)
  const alreadyRequested = bookingId ? Boolean(await getRecentPendingCallbackRequest(bookingId)) : false
  const vehicle = [view.model, view.variant].filter(Boolean).join(' ')

  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: '#0f172a', padding: '32px 16px' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 640px) {
          main {
            padding: 16px 12px !important;
          }
          .header-gradient {
            padding: 28px 20px 24px !important;
          }
          .form-container {
            border-radius: 20px !important;
          }
        }
      `}} />
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="form-container" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 24, overflow: 'hidden', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.03), 0 8px 10px -6px rgba(0,0,0,0.03)' }}>
          <div className="header-gradient" style={{ background: 'linear-gradient(135deg, #09090b 0%, #1e293b 100%)', padding: '32px 32px 28px' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>{BRAND}</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
              Hi {view.customerFirstName}, request a callback
            </h1>
            <div style={{ display: 'inline-flex', alignItems: 'center', marginTop: 12, padding: '5px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                {vehicle || 'Your Kia vehicle'} · {view.bookingNumber}
              </span>
            </div>
          </div>
          {alreadyRequested ? (
            <AlreadyRequested firstName={view.customerFirstName} />
          ) : (
            <CallbackRequestForm
              token={token}
              customerFirstName={view.customerFirstName}
              accent={ACCENT}
            />
          )}
        </div>
        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 11, color: '#94a3b8', letterSpacing: '0.02em' }}>
          We never share your details. Powered by {BRAND}.
        </p>
      </div>
    </main>
  )
}
