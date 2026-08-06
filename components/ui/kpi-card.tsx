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
  chartType?: 'area' | 'bar' | 'line' | 'flat-line' | 'progress' | 'radial'
  chartData?: number[]
  progressPercentage?: number
  /**
   * Set false to render the card with no sparkline at all. The chart renderers fall back to a
   * decorative placeholder series when `chartData` is empty, which is fine as chrome but reads as
   * real history on a data-integrity-sensitive card. Callers that would otherwise be showing an
   * invented trend should pass false. Defaults to true so existing call sites are unaffected.
   */
  showChart?: boolean
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
  progressPercentage,
  showChart = true,
  onClick,
  onMoreClick,
}) => {
  // Rich distinct theme styling per colorScheme
  const schemeStyles = {
    purple: {
      containerBg: 'bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/40 border-indigo-200/80 shadow-[0_8px_24px_-4px_rgba(79,70,229,0.12)] hover:border-indigo-300 hover:shadow-[0_16px_36px_-6px_rgba(79,70,229,0.2)]',
      iconBg: 'bg-indigo-600 bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-500/25',
      titleColor: 'text-indigo-900/80',
      valueColor: 'text-indigo-950',
      subtitleColor: 'text-indigo-600/80',
      stroke: '#4f46e5',
      fillFrom: '#6366f1',
      fillTo: '#ffffff',
      barBg: 'bg-gradient-to-t from-indigo-600 to-blue-500',
      trendBg: 'bg-indigo-100/70 text-indigo-700 border-indigo-200/60',
      progressTrack: 'bg-indigo-100',
      progressFill: 'bg-gradient-to-r from-indigo-500 to-blue-600',
    },
    emerald: {
      containerBg: 'bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/40 border-emerald-200/80 shadow-[0_8px_24px_-4px_rgba(16,185,129,0.12)] hover:border-emerald-300 hover:shadow-[0_16px_36px_-6px_rgba(16,185,129,0.2)]',
      iconBg: 'bg-emerald-600 bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/25',
      titleColor: 'text-emerald-900/80',
      valueColor: 'text-emerald-950',
      subtitleColor: 'text-emerald-600/80',
      stroke: '#10b981',
      fillFrom: '#10b981',
      fillTo: '#ffffff',
      barBg: 'bg-gradient-to-t from-emerald-600 to-teal-500',
      trendBg: 'bg-emerald-100/70 text-emerald-700 border-emerald-200/60',
      progressTrack: 'bg-emerald-100',
      progressFill: 'bg-gradient-to-r from-emerald-500 to-teal-600',
    },
    rose: {
      containerBg: 'bg-gradient-to-br from-rose-50/80 via-white to-red-50/40 border-rose-200/80 shadow-[0_8px_24px_-4px_rgba(244,63,94,0.12)] hover:border-rose-300 hover:shadow-[0_16px_36px_-6px_rgba(244,63,94,0.2)]',
      iconBg: 'bg-rose-600 bg-gradient-to-br from-rose-600 to-red-600 text-white shadow-md shadow-rose-500/25',
      titleColor: 'text-rose-900/80',
      valueColor: 'text-rose-950',
      subtitleColor: 'text-rose-600/80',
      stroke: '#f43f5e',
      fillFrom: '#f43f5e',
      fillTo: '#ffffff',
      barBg: 'bg-gradient-to-t from-rose-600 to-red-500',
      trendBg: 'bg-rose-100/70 text-rose-700 border-rose-200/60',
      progressTrack: 'bg-rose-100',
      progressFill: 'bg-gradient-to-r from-rose-500 to-red-600',
    },
    amber: {
      containerBg: 'bg-gradient-to-br from-amber-50/80 via-white to-orange-50/40 border-amber-200/80 shadow-[0_8px_24px_-4px_rgba(245,158,11,0.12)] hover:border-amber-300 hover:shadow-[0_16px_36px_-6px_rgba(245,158,11,0.2)]',
      iconBg: 'bg-amber-500 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/25',
      titleColor: 'text-amber-900/80',
      valueColor: 'text-amber-950',
      subtitleColor: 'text-amber-600/80',
      stroke: '#f59e0b',
      fillFrom: '#f59e0b',
      fillTo: '#ffffff',
      barBg: 'bg-gradient-to-t from-amber-500 to-orange-500',
      trendBg: 'bg-amber-100/70 text-amber-800 border-amber-200/60',
      progressTrack: 'bg-amber-100',
      progressFill: 'bg-gradient-to-r from-amber-500 to-orange-600',
    },
    teal: {
      containerBg: 'bg-gradient-to-br from-teal-50/80 via-white to-cyan-50/40 border-teal-200/80 shadow-[0_8px_24px_-4px_rgba(13,148,136,0.12)] hover:border-teal-300 hover:shadow-[0_16px_36px_-6px_rgba(13,148,136,0.2)]',
      iconBg: 'bg-gradient-to-br from-[#055B65] to-[#0d9488] text-white shadow-md shadow-teal-500/25',
      titleColor: 'text-[#033A41]',
      valueColor: 'text-[#02282D]',
      subtitleColor: 'text-[#055B65]',
      stroke: '#055B65',
      fillFrom: '#0d9488',
      fillTo: '#ffffff',
      barBg: 'bg-gradient-to-t from-[#055B65] to-[#0d9488]',
      trendBg: 'bg-teal-100/70 text-teal-800 border-teal-200/60',
      progressTrack: 'bg-teal-100',
      progressFill: 'bg-gradient-to-r from-[#055B65] to-[#0d9488]',
    },
    blue: {
      containerBg: 'bg-gradient-to-br from-sky-50/80 via-white to-blue-50/40 border-sky-200/80 shadow-[0_8px_24px_-4px_rgba(2,132,199,0.12)] hover:border-sky-300 hover:shadow-[0_16px_36px_-6px_rgba(2,132,199,0.2)]',
      iconBg: 'bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-md shadow-sky-500/25',
      titleColor: 'text-sky-900/80',
      valueColor: 'text-sky-950',
      subtitleColor: 'text-sky-600/80',
      stroke: '#0284c7',
      fillFrom: '#38bdf8',
      fillTo: '#ffffff',
      barBg: 'bg-gradient-to-t from-blue-600 to-sky-400',
      trendBg: 'bg-sky-100/70 text-sky-800 border-sky-200/60',
      progressTrack: 'bg-sky-100',
      progressFill: 'bg-gradient-to-r from-blue-600 to-sky-500',
    },
  }[colorScheme]

  // Render Bezier Area Sparkline
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
            <stop offset="0%" stopColor={schemeStyles.fillFrom} stopOpacity="0.4" />
            <stop offset="100%" stopColor={schemeStyles.fillTo} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path d={pathD} fill="none" stroke={schemeStyles.stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  // Render 3D Bar Sparkline
  const renderBarChart = () => {
    const data = chartData.length > 0 ? chartData : [25, 40, 30, 70, 45, 90, 55, 30]
    const max = Math.max(...data, 1)

    return (
      <div className="flex items-end justify-end gap-1.5 sm:gap-2 h-10 w-full pt-2 pr-1">
        {data.map((val, idx) => {
          const heightPct = Math.max(Math.round((val / max) * 100), 15)
          return (
            <div
              key={idx}
              className={`w-[7px] rounded-t-lg ${schemeStyles.barBg} transition-all duration-300 shadow-xs hover:scale-y-110 shrink-0`}
              style={{ height: `${heightPct}%` }}
            />
          )
        })}
      </div>
    )
  }

  // Render Horizontal Progress Bar Visual
  const renderProgressBar = () => {
    const pct = progressPercentage ?? 72
    return (
      <div className="w-full pt-3 pb-1 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-black">
          <span className="text-slate-400">TARGET FULFILLMENT</span>
          <span className="font-mono">{pct}%</span>
        </div>
        <div className={`h-2.5 w-full rounded-full ${schemeStyles.progressTrack} overflow-hidden p-0.5 shadow-inner`}>
          <div
            className={`h-full rounded-full ${schemeStyles.progressFill} transition-all duration-500 shadow-xs`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }

  // Render Radial Circle Ring Visual
  const renderRadialRing = () => {
    const pct = progressPercentage ?? 65
    const radius = 18
    const circ = 2 * Math.PI * radius
    const strokeDashoffset = circ - (pct / 100) * circ

    return (
      <div className="flex items-center justify-end gap-3 pt-1">
        <div className="text-right">
          <span className="text-[10px] font-black uppercase text-slate-400 block">Rate</span>
          <span className="text-sm font-black font-mono">{pct}%</span>
        </div>
        <svg className="h-11 w-11 transform -rotate-90">
          <circle
            cx="22"
            cy="22"
            r={radius}
            stroke="currentColor"
            strokeWidth="3.5"
            className="text-slate-200"
            fill="transparent"
          />
          <circle
            cx="22"
            cy="22"
            r={radius}
            stroke={schemeStyles.stroke}
            strokeWidth="3.5"
            strokeDasharray={circ}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-500"
          />
        </svg>
      </div>
    )
  }

  // Render Flat Line Chart
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
      className={`group rounded-3xl ${schemeStyles.containerBg} p-5 flex flex-col justify-between relative transition-all duration-300 hover:-translate-y-1.5 ${
        onClick ? 'cursor-pointer active:translate-y-0 active:shadow-md' : ''
      }`}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${schemeStyles.iconBg} border border-white/40 shrink-0 transition-transform duration-300 group-hover:scale-110`}>
            <Icon className="w-6 h-6 stroke-[2.5] text-white" />
          </div>
          <div>
            <span className={`text-[10px] font-black uppercase tracking-wider block ${schemeStyles.titleColor}`}>{title}</span>
            <span className={`text-2xl font-black leading-none mt-1 block drop-shadow-2xs ${schemeStyles.valueColor}`}>{value}</span>
            {subtitle && <span className={`text-[10px] font-bold block mt-1 ${schemeStyles.subtitleColor}`}>{subtitle}</span>}
          </div>
        </div>

        {/* Top Right Action */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoreClick?.()
          }}
          className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-black/5 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Middle Embedded Chart Visual */}
      {showChart && (
        <div className="mt-4 mb-2">
          {chartType === 'area' && renderAreaChart()}
          {chartType === 'bar' && renderBarChart()}
          {chartType === 'progress' && renderProgressBar()}
          {chartType === 'radial' && renderRadialRing()}
          {chartType === 'flat-line' && renderFlatLine()}
          {chartType === 'line' && renderAreaChart()}
        </div>
      )}

      {/* Bottom Row: Trend Badge */}
      {trend && (
        <div className="flex items-center justify-between pt-1 text-[10px] font-bold">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 border ${schemeStyles.trendBg}`}>
            <span>{trend.value}</span>
            {trend.isPositive !== false ? (
              <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 stroke-[2.5]" />
            )}
            {trend.label && <span className="font-semibold opacity-80 ml-1">{trend.label}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
