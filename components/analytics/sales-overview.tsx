'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'

const data = [
  { name: 'Oct', sales: 4000, revenue: 2400 },
  { name: 'Nov', sales: 3000, revenue: 1398 },
  { name: 'Dec', sales: 2000, revenue: 9800 },
  { name: 'Jan', sales: 2780, revenue: 3908 },
  { name: 'Feb', sales: 1890, revenue: 4800 },
  { name: 'Mar', sales: 2390, revenue: 3800 },
  { name: 'Apr', sales: 3490, revenue: 4300 },
]

export function SalesOverview() {
  return (
    <Card className="col-span-4 border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-8">
        <div>
          <CardTitle className="text-lg font-bold">Sales Overview</CardTitle>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black">$ 9,257.51</span>
            <span className="text-xs font-bold text-emerald-500">+15.8%</span>
            <span className="text-[10px] font-medium text-muted-foreground">+$143.50 Increased</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-16 rounded-lg bg-accent/50 flex items-center justify-center text-[10px] font-bold">Filter</div>
          <div className="h-8 w-16 rounded-lg bg-accent/50 flex items-center justify-center text-[10px] font-bold">Sort</div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(var(--muted-foreground))' }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(var(--muted-foreground))' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                }}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="hsl(var(--primary))"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorSales)"
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--chart-2))"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
