import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ActivityItem {
  id: string
  title: string
  description: string
  time: string
  type?: 'job' | 'vehicle' | 'inventory' | 'recon'
}

interface ActivityCardProps {
  title: string
  activities: ActivityItem[]
  className?: string
}

export function ActivityCard({ title, activities, className }: ActivityCardProps) {
  const getTypeColor = (type?: string) => {
    switch (type) {
      case 'job':
        return 'bg-blue-500'
      case 'vehicle':
        return 'bg-green-500'
      case 'inventory':
        return 'bg-orange-500'
      case 'recon':
        return 'bg-purple-500'
      default:
        return 'bg-gray-500'
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3">
              <div className={`mt-1 h-2 w-2 rounded-full ${getTypeColor(activity.type)}`} />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">{activity.title}</p>
                <p className="text-xs text-muted-foreground">{activity.description}</p>
              </div>
              <p className="text-xs text-muted-foreground whitespace-nowrap">{activity.time}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
