import type { Metadata } from 'next'
import { getTrackingView, type KiaTrackingView } from '@/lib/kia/tracking'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Track Your Kia Booking',
  robots: { index: false, follow: false },
}

const BRAND = 'AM Kia'
const ACCENT = '#055B65'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function NotFound() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 460, width: '100%', background: '#fff', borderRadius: 24, border: '1px solid #e2e8f0', padding: 32, textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.02), 0 8px 10px -6px rgba(0,0,0,0.02)' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT }}>{BRAND}</div>
        <h1 style={{ margin: '16px 0 8px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Link not found</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#64748b' }}>
          This tracking link is invalid or has expired. Please contact your sales consultant for an up-to-date link.
        </p>
      </div>
    </main>
  )
}

function StepRow({ step, index, total }: { step: KiaTrackingView['steps'][number]; index: number; total: number }) {
  const done = step.state === 'done'
  const current = step.state === 'current'
  const color = done ? '#10b981' : current ? ACCENT : '#cbd5e1'
  const isLast = index === total - 1
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: done ? '#10b981' : current ? ACCENT : '#fff',
            border: `2px solid ${done ? '#10b981' : current ? ACCENT : '#e2e8f0'}`,
            color: done || current ? '#fff' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: done ? 15 : 13,
            fontWeight: 800,
            flexShrink: 0,
            boxShadow: current ? `0 0 0 4px rgba(79, 70, 229, 0.15)` : 'none',
          }}
        >
          {done ? '✓' : index + 1}
        </div>
        {!isLast && <div style={{ width: 2, flex: 1, minHeight: 32, background: done ? '#10b981' : '#e2e8f0' }} />}
      </div>
      <div style={{ paddingBottom: isLast ? 0 : 26 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: current ? '#0f172a' : done ? '#334155' : '#94a3b8', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span>{step.label}</span>
          {current && (
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: ACCENT, background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.15)', padding: '2px 8px', borderRadius: 999 }}>
              In progress
            </span>
          )}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: done || current ? '#64748b' : '#cbd5e1' }}>{step.hint}</p>
      </div>
    </div>
  )
}

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await getTrackingView(token)
  if (!view) return <NotFound />

  const vehicle = [view.model, view.variant].filter(Boolean).join(' ')
  const detailRows: Array<[string, string]> = [
    ['Booking Number', view.bookingNumber],
    ['Vehicle', vehicle || '—'],
    ['Colour', view.color || '—'],
    ['Consultant', view.consultantName || '—'],
    ['Booked On', formatDate(view.bookedAt)],
    view.deliveredAt
      ? ['Delivered On', formatDate(view.deliveredAt)]
      : ['Expected Delivery', view.expectedDeliveryDate ? formatDate(view.expectedDeliveryDate) : 'To be confirmed'],
  ]

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
          .card-container {
            border-radius: 20px !important;
          }
          .card-body {
            padding: 24px 20px !important;
          }
        }
      `}} />
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div className="card-container" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 24, overflow: 'hidden', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.03), 0 8px 10px -6px rgba(0,0,0,0.03)' }}>
          <div className="header-gradient" style={{ background: 'linear-gradient(135deg, #055B65 0%, #2f8f83 100%)', padding: '32px 32px 28px' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>{BRAND}</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
              Hi {view.customerFirstName}, here&rsquo;s your order status
            </h1>
            <div style={{ display: 'inline-flex', alignItems: 'center', marginTop: 12, padding: '5px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                {vehicle || 'Your Kia vehicle'} · {view.bookingNumber}
              </span>
            </div>
          </div>

          {view.cancelled ? (
            <div className="card-body" style={{ padding: 28 }}>
              <div style={{ borderRadius: 16, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.04)', padding: 20 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#ef4444' }}>This booking has been cancelled</p>
                <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: '#64748b' }}>
                  If you believe this is a mistake, please get in touch with your sales consultant.
                </p>
              </div>
            </div>
          ) : (
            <div className="card-body" style={{ padding: 32 }}>
              <div style={{ marginBottom: 28 }}>
                {view.steps.map((step, index) => (
                  <StepRow key={step.key} step={step} index={index} total={view.steps.length} />
                ))}
              </div>

              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
                <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {detailRows.map(([label, value]) => (
                      <tr key={label}>
                        <td style={{ padding: '8px 12px 8px 0', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                        <td style={{ padding: '8px 0', fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ padding: '20px 32px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#64748b' }}>
              Questions about your order? Contact your {view.consultantName ? `consultant, ${view.consultantName}` : 'sales consultant'} at {view.dealerCode || BRAND}.
            </p>
          </div>
        </div>
        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 11, color: '#94a3b8', letterSpacing: '0.02em' }}>
          This page updates automatically as your booking progresses. Powered by {BRAND}.
        </p>
      </div>
    </main>
  )
}
