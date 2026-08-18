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
  // Color palette matching the provided mockup 1-to-1
  const schemeStyles = {
    purple: { // Total Requests (Blue theme)
      containerBg: 'bg-white border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)]',
      iconBg: 'bg-blue-50/90 text-blue-600',
      titleColor: 'text-slate-400 font-extrabold',
      valueColor: 'text-slate-900 font-black',
      subtitleColor: 'text-slate-400 font-semibold',
      stroke: '#2563eb',
      fillFrom: '#3b82f6',
      fillTo: '#ffffff',
      barBg: 'bg-blue-500',
      trendValColor: 'text-blue-600 font-extrabold',
    },
    amber: { // Pending Approvals (Orange/Amber theme)
      containerBg: 'bg-white border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)]',
      iconBg: 'bg-amber-50/90 text-amber-600',
      titleColor: 'text-slate-400 font-extrabold',
      valueColor: 'text-slate-900 font-black',
      subtitleColor: 'text-slate-400 font-semibold',
      stroke: '#f59e0b',
      fillFrom: '#f59e0b',
      fillTo: '#ffffff',
      barBg: 'bg-amber-400/80',
      trendValColor: 'text-amber-600 font-extrabold',
    },
    emerald: { // Approved Volume (Green theme)
      containerBg: 'bg-white border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)]',
      iconBg: 'bg-emerald-50/90 text-emerald-600',
      titleColor: 'text-slate-400 font-extrabold',
      valueColor: 'text-[#059669] font-black',
      subtitleColor: 'text-slate-400 font-semibold',
      stroke: '#10b981',
      fillFrom: '#10b981',
      fillTo: '#ffffff',
      barBg: 'bg-emerald-500',
      trendValColor: 'text-emerald-600 font-extrabold',
    },
    rose: { // Rejected (Rose/Red theme)
      containerBg: 'bg-white border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)]',
      iconBg: 'bg-rose-50/90 text-rose-600',
      titleColor: 'text-slate-400 font-extrabold',
      valueColor: 'text-slate-900 font-black',
      subtitleColor: 'text-slate-400 font-semibold',
      stroke: '#ef4444',
      fillFrom: '#ef4444',
      fillTo: '#ffffff',
      barBg: 'bg-rose-500',
      trendValColor: 'text-rose-600 font-extrabold',
    },
    teal: {
      containerBg: 'bg-white border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)]',
      iconBg: 'bg-teal-50/90 text-[#055B65]',
      titleColor: 'text-slate-400 font-extrabold',
      valueColor: 'text-[#055B65] font-black',
      subtitleColor: 'text-slate-400 font-semibold',
      stroke: '#055B65',
      fillFrom: '#0d9488',
      fillTo: '#ffffff',
      barBg: 'bg-[#055B65]',
      trendValColor: 'text-[#055B65] font-extrabold',
    },
    blue: {
      containerBg: 'bg-white border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.06)]',
      iconBg: 'bg-sky-50/90 text-sky-600',
      titleColor: 'text-slate-400 font-extrabold',
      valueColor: 'text-slate-900 font-black',
      subtitleColor: 'text-slate-400 font-semibold',
      stroke: '#0284c7',
      fillFrom: '#38bdf8',
      fillTo: '#ffffff',
      barBg: 'bg-sky-500',
      trendValColor: 'text-sky-600 font-extrabold',
    },
  }[colorScheme]

  // Render Bezier Area Sparkline with end node circle (compact right-aligned)
  const renderAreaChart = () => {
    const defaultWave = [25, 75, 35, 90, 45, 80, 55, 95]
    const rawData = chartData.length > 0 ? chartData : defaultWave
    const min = Math.min(...rawData)
    const max = Math.max(...rawData)
    const range = max - min

    // If chartData is all 0s, flat, or has no height variation, generate dynamic up-down peaks and valleys
    const normalizedData = (range < 0.001)
      ? defaultWave
      : rawData.map((val, idx) => {
          // If the data is monotonically rising/falling without peaks/valleys, add dynamic up-down oscillations
          const isMonotonic = rawData.every((v, i) => i === 0 || v >= rawData[i - 1]) ||
                              rawData.every((v, i) => i === 0 || v <= rawData[i - 1])
          if (isMonotonic && rawData.length > 2) {
            const dip = (idx % 2 === 1 ? 0.35 : -0.25) * range
            return val + dip
          }
          return val
        })

    const nMin = Math.min(...normalizedData)
    const nMax = Math.max(...normalizedData)
    const nRange = nMax - nMin || 1

    const width = 130
    const height = 36
    const rightPadding = 5

    const points = normalizedData.map((val, idx) => {
      const x = (idx / (normalizedData.length - 1)) * (width - rightPadding)
      const y = height - ((val - nMin) / nRange) * (height - 12) - 6
      return { x, y }
    })

    let pathD = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i]
      const next = points[i + 1]
      const cpX = (current.x + next.x) / 2
      pathD += ` C ${cpX} ${current.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`
    }

    const areaD = `${pathD} L ${width - rightPadding} ${height} L 0 ${height} Z`
    const lastPoint = points[points.length - 1]
    const gradientId = `kpi-grad-${colorScheme}-${title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`

    return (
      <svg className="w-full h-9 overflow-hidden" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={schemeStyles.fillFrom} stopOpacity="0.25" />
            <stop offset="100%" stopColor={schemeStyles.fillTo} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path d={pathD} fill="none" stroke={schemeStyles.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="2.5" fill="#ffffff" stroke={schemeStyles.stroke} strokeWidth="2" />
      </svg>
    )
  }

  // Render Bar Sparkline (matches mockup)
  const renderBarChart = () => {
    const data = chartData.length > 0 ? chartData : [15, 30, 20, 50, 35, 75, 40, 20]
    const max = Math.max(...data, 1)

    return (
      <div className="flex items-end justify-end gap-1.5 h-8 w-full overflow-hidden">
        {data.map((val, idx) => {
          const heightPct = Math.max(Math.round((val / max) * 100), 18)
          return (
            <div
              key={idx}
              // transition-transform, NOT transition-all: `all` also captured the inline height,
              // so every data refresh animated layout on every bar of every card for 300ms.
              className={`w-[4px] sm:w-[5px] rounded-t-xs ${schemeStyles.barBg} transition-transform duration-300 hover:scale-y-110 shrink-0`}
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
      <div className="w-full space-y-1">
        <div className="flex items-center justify-between text-[9px] font-black">
          <span className="text-slate-400 uppercase">Target</span>
          <span className="font-mono">{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden p-0.5 shadow-inner">
          {/* scaleX, not width: width transitions re-run layout every frame; scaleX composites. */}
          <div
            className={`h-full w-full origin-left rounded-full ${schemeStyles.barBg} transition-transform duration-500`}
            style={{ transform: `scaleX(${Math.min(Math.max(pct, 0), 100) / 100})` }}
          />
        </div>
      </div>
    )
  }

  // Render Radial Circle Ring Visual
  const renderRadialRing = () => {
    const pct = progressPercentage ?? 65
    const radius = 14
    const circ = 2 * Math.PI * radius
    const strokeDashoffset = circ - (pct / 100) * circ

    return (
      <div className="flex items-center justify-end gap-2">
        <div className="text-right">
          <span className="text-[8px] font-black uppercase text-slate-400 block">Rate</span>
          <span className="text-xs font-black font-mono">{pct}%</span>
        </div>
        <svg className="h-8 w-8 transform -rotate-90">
          <circle
            cx="16"
            cy="16"
            r={radius}
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-slate-200"
            fill="transparent"
          />
          <circle
            cx="16"
            cy="16"
            r={radius}
            stroke={schemeStyles.stroke}
            strokeWidth="2.5"
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

  // Render Flat Line Chart with up-down wave
  const renderFlatLine = () => {
    return renderAreaChart()
  }

  return (
    <div
      onClick={onClick}
      className={`group rounded-3xl ${schemeStyles.containerBg} p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 hover:-translate-y-1 ${
        onClick ? 'cursor-pointer active:translate-y-0 active:shadow-md' : ''
      }`}
    >
      {/* Top Row: Soft pastel icon badge on left, Title + Value + Subtitle in middle, More button on right */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          {/* Soft pastel rounded icon badge */}
          <div className={`flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl ${schemeStyles.iconBg} shrink-0 transition-transform duration-300 group-hover:scale-105`}>
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2]" />
          </div>

          <div className="min-w-0">
            <span className={`text-[10px] font-black uppercase tracking-wider block truncate ${schemeStyles.titleColor}`}>{title}</span>
            <span className={`text-xl sm:text-2xl font-black leading-none mt-1.5 block truncate ${schemeStyles.valueColor}`}>{value}</span>
            {subtitle && <span className={`text-[10px] font-medium block mt-1.5 truncate ${schemeStyles.subtitleColor}`}>{subtitle}</span>}
          </div>
        </div>

        {/* Top Right Action Button — only when there is actually something behind it. It used to
            render unconditionally, so every card carried a keyboard-reachable button that did
            nothing (four per view on screens that pass no handler). Cards that DO pass onMoreClick
            are unaffected. */}
        {onMoreClick && (
          <button
            type="button"
            aria-label={`More options for ${title}`}
            onClick={(e) => {
              e.stopPropagation()
              onMoreClick()
            }}
            className="text-slate-300 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-50 transition-colors shrink-0"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Bottom Row: Trend Badge on left, Right-Aligned Compact Sparkline Visual on right */}
      <div className="flex items-end justify-between gap-2 mt-4 pt-1">
        {/* Left: Trend Badge Pill */}
        {trend ? (
          <div className="flex items-center justify-start text-[10px] sm:text-[11px] min-w-0">
            <span className="inline-flex items-center gap-1 sm:gap-1.5 rounded-full bg-slate-50/90 border border-slate-100 px-2.5 sm:px-3 py-1 font-semibold text-slate-400 truncate">
              <span className={`flex items-center gap-1 ${schemeStyles.trendValColor} shrink-0`}>
                {trend.isPositive !== false ? (
                  <TrendingUp className="w-3.5 h-3.5 stroke-[2.5]" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
                <span>{trend.value}</span>
              </span>
              {trend.label && <span className="text-slate-400 font-medium ml-0.5 truncate">{trend.label}</span>}
            </span>
          </div>
        ) : <div />}

        {/* Right: Compact Right-Aligned Sparkline Chart */}
        {showChart && (
          <div className="w-20 sm:w-24 h-9 flex items-end justify-end shrink-0 overflow-hidden">
            {chartType === 'area' && renderAreaChart()}
            {chartType === 'bar' && renderBarChart()}
            {chartType === 'progress' && renderProgressBar()}
            {chartType === 'radial' && renderRadialRing()}
            {chartType === 'flat-line' && renderFlatLine()}
            {chartType === 'line' && renderAreaChart()}
          </div>
        )}
      </div>
    </div>
  )
}

