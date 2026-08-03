import React from 'react'
import { MoreHorizontal, TrendingUp, TrendingDown } from 'lucide-react'

export interface KpiCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  trend?: {
    value: string
    isPositive?: boolean
    label?: string
  }
  colorScheme?: 'purple' | 'amber' | 'emerald' | 'rose' | 'teal' | 'blue'
  chartType?: 'area' | 'bar' | 'line' | 'flat-line'
  chartData?: number[]
  onClick?: () => void
  onMoreClick?: () => void
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  colorScheme = 'purple',
  chartType = 'area',
  chartData = [20, 45, 35, 50, 80, 60, 75],
  onClick,
  onMoreClick,
}) => {
  // Theme color definitions
  const schemeStyles = {
    purple: {
      iconBg: 'bg-indigo-50 text-indigo-600',
      stroke: '#6366f1',
      fillFrom: '#818cf8',
      fillTo: '#ffffff',
      barBg: 'bg-indigo-400',
      trendText: 'text-emerald-600',
      badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    },
    amber: {
      iconBg: 'bg-amber-50 text-amber-600',
      stroke: '#f59e0b',
      fillFrom: '#fbbf24',
      fillTo: '#ffffff',
      barBg: 'bg-amber-400',
      trendText: 'text-emerald-600',
      badgeBg: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    emerald: {
      iconBg: 'bg-emerald-50 text-emerald-600',
      stroke: '#10b981',
      fillFrom: '#34d399',
      fillTo: '#ffffff',
      barBg: 'bg-emerald-400',
      trendText: 'text-emerald-600',
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
    rose: {
      iconBg: 'bg-rose-50 text-rose-600',
      stroke: '#ef4444',
      fillFrom: '#f87171',
      fillTo: '#ffffff',
      barBg: 'bg-rose-400',
      trendText: 'text-slate-500',
      badgeBg: 'bg-rose-50 text-rose-700 border-rose-100',
    },
    teal: {
      iconBg: 'bg-teal-50 text-[#055B65]',
      stroke: '#055B65',
      fillFrom: '#4dcad4',
      fillTo: '#ffffff',
      barBg: 'bg-teal-600',
      trendText: 'text-emerald-600',
      badgeBg: 'bg-teal-50 text-teal-800 border-teal-100',
    },
    blue: {
      iconBg: 'bg-sky-50 text-sky-600',
      stroke: '#0284c7',
      fillFrom: '#38bdf8',
      fillTo: '#ffffff',
      barBg: 'bg-sky-400',
      trendText: 'text-emerald-600',
      badgeBg: 'bg-sky-50 text-sky-700 border-sky-100',
    },
  }[colorScheme]

  // Render pure SVG Area Sparkline
  const renderAreaChart = () => {
    const data = chartData.length > 0 ? chartData : [20, 40, 30, 60, 80, 50, 75]
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const width = 160
    const height = 45

    const points = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * width
      const y = height - ((val - min) / range) * (height - 12) - 6
      return { x, y }
    })

    // Construct smooth bezier curve
    let pathD = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i]
      const next = points[i + 1]
      const cpX = (current.x + next.x) / 2
      pathD += ` C ${cpX} ${current.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`
    }

    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`
    const gradientId = `kpi-grad-${colorScheme}-${title.replace(/\s+/g, '-').toLowerCase()}`

    return (
      <svg className="w-full h-12 overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={schemeStyles.fillFrom} stopOpacity="0.35" />
            <stop offset="100%" stopColor={schemeStyles.fillTo} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path d={pathD} fill="none" stroke={schemeStyles.stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  // Render Mini Bar Chart
  const renderBarChart = () => {
    const data = chartData.length > 0 ? chartData : [25, 40, 30, 70, 45, 90, 55, 30]
    const max = Math.max(...data, 1)

    return (
      <div className="flex items-end justify-end gap-1.5 sm:gap-2 h-10 w-full pt-2 pr-2">
        {data.map((val, idx) => {
          const heightPct = Math.max(Math.round((val / max) * 100), 12)
          return (
            <div
              key={idx}
              className={`w-[6px] rounded-full ${schemeStyles.barBg} transition-all duration-300 opacity-80 hover:opacity-100 shrink-0`}
              style={{ height: `${heightPct}%` }}
            />
          )
        })}
      </div>
    )
  }

  // Render Flat Line Chart (for 0 / steady state metrics)
  const renderFlatLine = () => {
    const width = 160
    const height = 30
    const y = 15

    return (
      <svg className="w-full h-8 overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={y} x2={width} y2={y} stroke={schemeStyles.stroke} strokeWidth="2" strokeDasharray="4 2" />
        {[10, 45, 80, 115, 150].map((cx, idx) => (
          <circle key={idx} cx={cx} cy={y} r="3" fill={schemeStyles.stroke} />
        ))}
      </svg>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`group bg-gradient-to-b from-white via-white to-slate-50/60 rounded-3xl border border-slate-200/80 shadow-[0_12px_28px_-6px_rgba(15,23,42,0.08),0_4px_12px_-2px_rgba(15,23,42,0.03)] p-5 flex flex-col justify-between relative transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_22px_45px_-10px_rgba(15,23,42,0.14),0_8px_20px_-6px_rgba(15,23,42,0.06)] hover:border-slate-300/90 ${
        onClick ? 'cursor-pointer active:translate-y-0 active:shadow-md' : ''
      }`}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${schemeStyles.iconBg} shadow-[0_4px_12px_rgba(0,0,0,0.05),inset_0_1px_1px_rgba(255,255,255,0.9)] border border-white/80 shrink-0 transition-transform duration-300 group-hover:scale-105`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">{title}</span>
            <span className="text-2xl font-black text-slate-900 leading-none mt-1 block drop-shadow-xs">{value}</span>
            {subtitle && <span className="text-[10px] font-semibold text-slate-400 block mt-1">{subtitle}</span>}
          </div>
        </div>

        {/* Top Right Context Action */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoreClick?.()
          }}
          className="text-slate-300 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100/70 transition-colors shadow-2xs hover:shadow-xs"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Middle Embedded Visual Chart */}
      <div className="mt-4 mb-2">
        {chartType === 'area' && renderAreaChart()}
        {chartType === 'bar' && renderBarChart()}
        {chartType === 'flat-line' && renderFlatLine()}
        {chartType === 'line' && renderAreaChart()}
      </div>

      {/* Bottom Row: Trend Badge */}
      {trend && (
        <div className="flex items-center justify-between pt-1 text-[10px] font-bold">
          <span className={`flex items-center gap-1 ${trend.isPositive !== false ? 'text-emerald-600' : 'text-rose-600'}`}>
            <span>{trend.value}</span>
            {trend.isPositive !== false ? (
              <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 stroke-[2.5]" />
            )}
            {trend.label && <span className="text-slate-400 font-medium ml-1">{trend.label}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
