import { Sidebar } from './sidebar'
import { Header } from './header'
import { cn } from '@/lib/utils'

interface MainLayoutProps {
  children: React.ReactNode
  hideHeader?: boolean
}

export function MainLayout({ children, hideHeader = false }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 pl-24">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {!hideHeader && <Header />}
          <main className={cn("flex-1 overflow-y-auto", !hideHeader ? "p-10" : "p-10 pt-4")}>
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
