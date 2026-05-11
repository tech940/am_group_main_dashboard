import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KPICardProps {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
  icon?: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  iconColor?: 'purple' | 'blue' | 'orange' | 'pink' | 'teal'
}

export function KPICard({ title, value, change, changeLabel, icon, trend = 'neutral', iconColor = 'purple' }: KPICardProps) {
  const colorClasses = {
    purple: 'bg-purple-100 text-purple-600',
    blue: 'bg-blue-100 text-blue-600',
    orange: 'bg-orange-100 text-orange-600',
    pink: 'bg-pink-100 text-pink-600',
    teal: 'bg-teal-100 text-teal-600',
  }

  return (
    <Card className="border border-border/50 shadow-lg shadow-gray-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-gray-300/50">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className={cn('h-14 w-14 rounded-2xl flex items-center justify-center', colorClasses[iconColor])}>
            {icon && <div className="h-7 w-7">{icon}</div>}
          </div>
          {change !== undefined && (
            <div
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                trend === 'up' && 'bg-emerald-500/10 text-emerald-600',
                trend === 'down' && 'bg-rose-500/10 text-rose-600',
                trend === 'neutral' && 'bg-muted text-muted-foreground'
              )}
            >
              {trend === 'up' && <TrendingUp className="h-3 w-3" />}
              {trend === 'down' && <TrendingDown className="h-3 w-3" />}
              {change > 0 ? '+' : ''}{change}%
            </div>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-sm font-semibold text-muted-foreground">{title}</p>
          <div className="text-3xl font-black tracking-tight text-foreground">{value}</div>
        </div>

        {changeLabel && (
          <p className="mt-3 text-xs font-medium text-muted-foreground/70">
            {changeLabel}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

import { TrendingUp, TrendingDown } from 'lucide-react'
