'use client'

import { useState } from 'react'
import { ScrapAiInsight } from '@/lib/scrap-erp/types'
import { Sparkles, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function ScrapAiInsightsBanner({ insights }: { insights: ScrapAiInsight[] }) {
  const [activeIdx, setActiveIdx] = useState(0)

  if (!insights || insights.length === 0) return null

  const active = insights[activeIdx]

  return (
    <Card className="p-4 border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                AI Copilot Insight
              </span>
              {active.metricImpact && (
                <Badge variant="outline" className="text-[10px] font-bold text-emerald-600 border-emerald-300">
                  {active.metricImpact}
                </Badge>
              )}
            </div>
            <h4 className="mt-0.5 text-xs font-extrabold text-foreground">{active.title}</h4>
            <p className="mt-0.5 text-xs text-muted-foreground max-w-3xl">{active.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
          <div className="flex items-center gap-1 bg-background p-1 rounded-xl border border-border">
            {insights.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === activeIdx ? 'w-5 bg-indigo-600' : 'w-2 bg-muted hover:bg-muted-foreground/30'
                }`}
                title={item.title}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActiveIdx((prev) => (prev + 1) % insights.length)}
            className="rounded-xl text-xs h-8 px-2 font-bold"
          >
            Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
