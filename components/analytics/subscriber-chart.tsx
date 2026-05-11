'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  Tooltip,
} from 'recharts'

const data = [
  { name: 'Sun', value: 400 },
  { name: 'Mon', value: 300 },
  { name: 'Tue', value: 900 },
  { name: 'Wed', value: 450 },
  { name: 'Thu', value: 380 },
  { name: 'Fri', value: 520 },
  { name: 'Sat', value: 410 },
]

export function SubscriberChart() {
  return (
    <Card className="col-span-3 border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-sm font-bold text-muted-foreground/80">Total Subscriber</CardTitle>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black">24,473</span>
            <span className="text-[10px] font-bold text-emerald-500">8.3%</span>
          </div>
        </div>
        <div className="h-8 w-20 rounded-lg bg-accent/50 flex items-center justify-center text-[10px] font-bold">Weekly</div>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(var(--muted-foreground))' }}
                dy={10}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                }}
              />
              <Bar
                dataKey="value"
                fill="hsl(var(--primary))"
                radius={[6, 6, 0, 0]}
                barSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
