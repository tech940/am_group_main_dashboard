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
    <div className="dashboard-shell relative flex min-h-screen flex-col overflow-hidden">
      <div className="dashboard-orb dashboard-orb-left pointer-events-none absolute left-[18%] top-24 h-72 w-72 rounded-full blur-3xl" />
      <div className="dashboard-orb dashboard-orb-right pointer-events-none absolute right-[12%] top-6 h-80 w-80 rounded-full blur-3xl" />
      <div className="dashboard-orb dashboard-orb-bottom pointer-events-none absolute bottom-[-8rem] right-[26%] h-96 w-96 rounded-full blur-3xl" />
      <div className="relative z-10 flex flex-1 pl-0">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {!hideHeader && <Header title={title} subtitle={subtitle} />}
          <main className={cn("glass-dashboard-content flex-1 overflow-y-auto", !hideHeader ? "px-4 sm:px-8 pb-4 sm:pb-8 pt-4" : "px-4 sm:px-10 pb-4 sm:pb-10 pt-4")}>
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
