import { Sidebar } from './sidebar'
import { Header } from './header'
import { cn } from '@/lib/utils'

interface MainLayoutProps {
  children: React.ReactNode
  hideHeader?: boolean
  title?: string
  subtitle?: string
}

export function MainLayout({ children, hideHeader = false, title, subtitle }: MainLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_18%_12%,rgba(20,184,166,0.24),transparent_30%),radial-gradient(circle_at_78%_8%,rgba(45,212,191,0.20),transparent_28%),radial-gradient(circle_at_88%_82%,rgba(14,116,144,0.18),transparent_34%),linear-gradient(135deg,#f2fffc_0%,#f7fdfc_48%,#edf8ff_100%)]">
      <div className="pointer-events-none absolute left-[18%] top-24 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-[12%] top-6 h-80 w-80 rounded-full bg-teal-200/45 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-8rem] right-[26%] h-96 w-96 rounded-full bg-sky-200/30 blur-3xl" />
      <div className="relative z-10 flex flex-1 pl-0">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {!hideHeader && <Header title={title} subtitle={subtitle} />}
          <main className={cn("glass-dashboard-content flex-1 overflow-y-auto", !hideHeader ? "px-8 pb-8 pt-4" : "px-10 pb-10 pt-4")}>
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
