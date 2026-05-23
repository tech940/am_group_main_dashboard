import Link from 'next/link'

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60">
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-600">Access restricted</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">You do not have access to this branch.</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
          This section is available only to users assigned to the matching branch or users with all-branch access.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-2xl bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5"
        >
          Back to Dashboard
        </Link>
      </section>
    </main>
  )
}
