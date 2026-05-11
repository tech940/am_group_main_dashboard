'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const integrations = [
  {
    name: 'Stripe',
    type: 'Finance',
    rate: '45%',
    profit: '$850.00',
    icon: '💳',
  },
  {
    name: 'Zapier',
    type: 'CRM',
    rate: '80%',
    profit: '$1,230.50',
    icon: '⚡',
  },
  {
    name: 'Shopify',
    type: 'Marketplace',
    rate: '20%',
    profit: '$432.25',
    icon: '🛍️',
  },
]

export function IntegrationList() {
  return (
    <Card className="col-span-4 border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-bold">List of Integration</CardTitle>
        <button className="text-xs font-bold text-primary">See All</button>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            <span>Application</span>
            <span>Type</span>
            <span>Rate</span>
            <span>Profit</span>
          </div>
          <div className="space-y-4">
            {integrations.map((item) => (
              <div key={item.name} className="grid grid-cols-4 items-center">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-accent/50 text-lg">
                    {item.icon}
                  </div>
                  <span className="text-sm font-bold">{item.name}</span>
                </div>
                <span className="text-xs font-medium text-muted-foreground">{item.type}</span>
                <div className="w-24 h-1.5 rounded-full bg-accent relative overflow-hidden">
                  <div 
                    className="absolute inset-y-0 left-0 bg-primary" 
                    style={{ width: item.rate }}
                  />
                </div>
                <span className="text-sm font-bold">{item.profit}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
