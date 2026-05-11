import { MainLayout } from '@/components/layout/main-layout'
import { KPICard } from '@/components/analytics/kpi-card'
import { SalesOverview } from '@/components/analytics/sales-overview'
import { SubscriberChart } from '@/components/analytics/subscriber-chart'
import { SalesDistribution } from '@/components/analytics/sales-distribution'
import { IntegrationList } from '@/components/analytics/integration-list'
import { Car, Wrench, Package, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function DashboardPage() {
  return (
    <MainLayout>
      <div className="space-y-8 max-w-[1600px] mx-auto">
        {/* Dashboard Title & Stats Filter */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground mt-2">Overview of your operations and key metrics</p>
          </div>
          <div className="flex gap-2">
            <div className="h-10 px-4 rounded-xl bg-white shadow-sm flex items-center gap-2 text-xs font-bold text-muted-foreground/80 border border-border/50">
              <span className="opacity-60">Oct 18 - Nov 18</span>
            </div>
            <div className="h-11 px-6 rounded-xl bg-white shadow-sm flex items-center gap-2 text-xs font-bold text-muted-foreground/80 border border-border/50">
              <span>Monthly</span>
            </div>
          </div>
        </div>

        {/* KPI Cards Row */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Total Vehicles"
            value="156"
            change={12}
            changeLabel="from last month"
            icon={<Car className="h-full w-full" />}
            trend="up"
            iconColor="purple"
          />
          <KPICard
            title="Active Jobs"
            value="24"
            change={8}
            changeLabel="from last week"
            icon={<Wrench className="h-full w-full" />}
            trend="up"
            iconColor="blue"
          />
          <KPICard
            title="Inventory Items"
            value="1,234"
            change={-3}
            changeLabel="from last month"
            icon={<Package className="h-full w-full" />}
            trend="down"
            iconColor="orange"
          />
          <KPICard
            title="Pending Tasks"
            value="45"
            change={5}
            changeLabel="from yesterday"
            icon={<Clock className="h-full w-full" />}
            trend="up"
            iconColor="pink"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-7">
          <Card className="col-span-4 border border-border/50 shadow-lg shadow-gray-200/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">Weekly Overview</h2>
                  <p className="text-sm text-muted-foreground mt-1">Performance metrics this week</p>
                </div>
              </div>
              <SalesOverview />
            </CardContent>
          </Card>
          <Card className="col-span-3 border border-border/50 shadow-lg shadow-gray-200/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">Subscribers</h2>
                  <p className="text-sm text-muted-foreground mt-1">New signups this month</p>
                </div>
              </div>
              <SubscriberChart />
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row */}
        <div className="grid gap-6 lg:grid-cols-7">
          <Card className="col-span-4 border border-border/50 shadow-lg shadow-gray-200/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">Sales Distribution</h2>
                  <p className="text-sm text-muted-foreground mt-1">Revenue by category</p>
                </div>
              </div>
              <SalesDistribution />
            </CardContent>
          </Card>
          <Card className="col-span-3 border border-border/50 shadow-lg shadow-gray-200/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">Integrations</h2>
                  <p className="text-sm text-muted-foreground mt-1">Connected services</p>
                </div>
              </div>
              <IntegrationList />
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  )
}

