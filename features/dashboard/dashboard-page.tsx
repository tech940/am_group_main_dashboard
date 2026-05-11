import { MainLayout } from '@/components/layout/main-layout'
import { KPICard } from '@/components/analytics/kpi-card'
import { ActivityCard } from '@/components/analytics/activity-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Car,
  Wrench,
  Package,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from 'lucide-react'

export default function DashboardPage() {
  const activities = [
    {
      id: '1',
      title: 'New workshop job assigned',
      description: 'Job #1234 assigned to John Doe',
      time: '2 min ago',
      type: 'job' as const,
    },
    {
      id: '2',
      title: 'Vehicle inspection completed',
      description: 'VIN: ABC123456789 passed inspection',
      time: '15 min ago',
      type: 'vehicle' as const,
    },
    {
      id: '3',
      title: 'Inventory low stock alert',
      description: 'Oil filter quantity below minimum',
      time: '1 hour ago',
      type: 'inventory' as const,
    },
    {
      id: '4',
      title: 'Recon workflow updated',
      description: 'Vehicle XYZ987 moved to detailing stage',
      time: '2 hours ago',
      type: 'recon' as const,
    },
    {
      id: '5',
      title: 'New vehicle added',
      description: '2024 Toyota Camry added to inventory',
      time: '3 hours ago',
      type: 'vehicle' as const,
    },
  ]

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your operations and key metrics
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Total Vehicles"
            value="156"
            change={12}
            changeLabel="from last month"
            icon={<Car className="h-4 w-4" />}
            trend="up"
          />
          <KPICard
            title="Active Jobs"
            value="24"
            change={8}
            changeLabel="from last week"
            icon={<Wrench className="h-4 w-4" />}
            trend="up"
          />
          <KPICard
            title="Inventory Items"
            value="1,234"
            change={-3}
            changeLabel="from last month"
            icon={<Package className="h-4 w-4" />}
            trend="down"
          />
          <KPICard
            title="Pending Tasks"
            value="45"
            change={5}
            changeLabel="from yesterday"
            icon={<Clock className="h-4 w-4" />}
            trend="up"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
          {/* Chart Section */}
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Weekly Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Chart placeholder - Add Recharts integration here
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <ActivityCard
            title="Recent Activity"
            activities={activities}
            className="col-span-3"
          />
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm">
                <Wrench className="mr-2 h-4 w-4" />
                New Workshop Job
              </Button>
              <Button variant="outline" size="sm">
                <Car className="mr-2 h-4 w-4" />
                Add Vehicle
              </Button>
              <Button variant="outline" size="sm">
                <Package className="mr-2 h-4 w-4" />
                Update Inventory
              </Button>
              <Button variant="outline" size="sm">
                <Clock className="mr-2 h-4 w-4" />
                Create Task
              </Button>
              <Button variant="outline" size="sm">
                <TrendingUp className="mr-2 h-4 w-4" />
                View Reports
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workshop Efficiency</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">87%</div>
                  <p className="text-xs text-muted-foreground">On-time completion rate</p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recon Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">12/15</div>
                  <p className="text-xs text-muted-foreground">Vehicles in progress</p>
                </div>
                <Clock className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inventory Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">$45.2K</div>
                  <p className="text-xs text-muted-foreground">Total inventory value</p>
                </div>
                <TrendingDown className="h-8 w-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  )
}
