'use client'

import * as React from 'react'

/** The sticky action row at the bottom of a drawer form. */
export function FormFooter({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center justify-end gap-2 hp-sunken-bg border-t border-slate-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
      {note && <p className="mr-auto text-xs text-slate-500">{note}</p>}
      {children}
    </footer>
  )
}
