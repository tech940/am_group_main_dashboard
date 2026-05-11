'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

const data = [
  { name: 'Website', value: 374.82, color: 'hsl(var(--primary))' },
  { name: 'Mobile App', value: 241.6, color: 'hsl(var(--chart-2))' },
  { name: 'Other', value: 213.42, color: 'hsl(var(--chart-3))' },
]

export function SalesDistribution() {
  return (
    <Card className="col-span-3 border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-bold text-muted-foreground/80">Sales Distribution</CardTitle>
        <div className="h-8 w-20 rounded-lg bg-accent/50 flex items-center justify-center text-[10px] font-bold">Monthly</div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="h-[180px] w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: 'none',
                    borderRadius: '12px',
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-1/2 space-y-3">
            {data.map((item) => (
              <div key={item.name} className="flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[10px] font-bold text-muted-foreground/60">{item.name}</span>
                </div>
                <span className="text-sm font-black">$ {item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
