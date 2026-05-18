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
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 pl-0">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {!hideHeader && <Header title={title} subtitle={subtitle} />}
          <main className={cn("flex-1 overflow-y-auto", !hideHeader ? "px-8 pb-8" : "px-10 pb-10 pt-4")}>
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
