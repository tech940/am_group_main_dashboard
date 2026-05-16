'use client'

import React from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Users,
  Car,
  DollarSign,
  Wrench,
  MoreHorizontal
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts'
import { Button } from '@/components/ui/button'

const statCards = [
  { title: 'Total Sales', value: '3,256', sub: 'Total Vehicles', icon: Car, color: 'text-teal-600', bg: 'bg-teal-50' },
  { title: 'Available Staff', value: '394', sub: 'Service Team', icon: Users, color: 'text-teal-secondary', bg: 'bg-teal-100' },
  { title: 'Avg. Sale Price', value: '$25,536', sub: 'Per Vehicle', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { title: 'Service Cars', value: '38', sub: 'In Workshop', icon: Wrench, color: 'text-teal-700', bg: 'bg-teal-light' },
]

const salesData = [
  { month: 'Oct 2025', sales: 2400, service: 1400 },
  { month: 'Nov 2025', sales: 3100, service: 1800 },
  { month: 'Dec 2025', sales: 4200, service: 2200 },
  { month: 'Jan 2026', sales: 2600, service: 1600 },
  { month: 'Feb 2026', sales: 2800, service: 1700 },
  { month: 'Mar 2026', sales: 3600, service: 2100 },
]

const pieData = [
  { name: 'SUV', value: 400 },
  { name: 'Sedan', value: 300 },
  { name: 'Hatchback', value: 300 },
  { name: 'EV', value: 200 },
]

const COLORS = ['#055B65', '#45828B', '#10b981', '#B2C9C5']

const timelineData = [
  { time: '07 am', value: 40 },
  { time: '08 am', value: 80 },
  { time: '09 am', value: 65 },
  { time: '10 am', value: 95 },
  { time: '11 am', value: 85 },
  { time: '12 pm', value: 110 },
]

export default function DashboardPage() {
  return (
    <MainLayout>
      <div className="space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500">
        {/* Header Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((card, idx) => (
            <Card key={idx} className="border-none shadow-xl shadow-slate-200/50 rounded-[2rem] overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
              <CardContent className="p-8">
                <div className="flex justify-between items-start mb-6">
                  <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center", card.bg)}>
                    <card.icon className={cn("h-7 w-7", card.color)} />
                  </div>
                  <Button variant="ghost" size="icon" className="text-slate-300 hover:text-slate-600">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </div>
                <div>
                  <h3 className="text-3xl font-black text-slate-800 tracking-tight">{card.value}</h3>
                  <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-wider">{card.title}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Trend */}
          <Card className="lg:col-span-2 border-none shadow-xl shadow-slate-200/50 rounded-[2rem] p-8">
            <CardHeader className="p-0 mb-10 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xl font-black text-slate-800">Sales vs. Service Trend</CardTitle>
                <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-wider">Performance metrics over time</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-teal-600" />
                  <span className="text-xs font-bold text-slate-500">Sales</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold text-slate-500">Service</span>
                </div>
                <Button variant="outline" size="sm" className="rounded-xl border-slate-100 text-slate-500 font-bold ml-4">
                  Show by months <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData} barGap={8}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="sales" fill="#055B65" radius={[4, 4, 0, 0]} barSize={12} />
                  <Bar dataKey="service" fill="#10b981" radius={[4, 4, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Donut Chart */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-[2rem] p-8">
            <CardHeader className="p-0 mb-8">
              <CardTitle className="text-xl font-black text-slate-800">Sales by Category</CardTitle>
              <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-wider">Popular vehicle types</p>
            </CardHeader>
            <div className="h-[300px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={100}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <Users className="h-8 w-8 text-slate-200 mb-1" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Growth</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6">
              {pieData.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[idx] }} />
                  <span className="text-xs font-bold text-slate-600">{item.name}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Area Chart */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-[2rem] p-8 lg:col-span-1">
            <div className="flex justify-between items-center mb-8">
              <div>
                <CardTitle className="text-xl font-black text-slate-800">Sales Velocity</CardTitle>
                <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-wider">Hourly performance</p>
              </div>
              <Button variant="ghost" className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Today <ChevronDown className="ml-1 h-3 w-3" /></Button>
            </div>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip />
                  <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between mt-4">
              {timelineData.map((d, i) => (
                <span key={i} className="text-[10px] font-bold text-slate-400 uppercase">{d.time}</span>
              ))}
            </div>
          </Card>

          {/* List Section */}
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-[2rem] p-8">
            <div className="flex justify-between items-center mb-8">
              <CardTitle className="text-xl font-black text-slate-800">Top Branches</CardTitle>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </div>
            <div className="space-y-6">
              {[
                { name: 'Jammu Central', value: 247, icon: Car, color: 'text-teal-600' },
                { name: 'Srinagar North', value: 164, icon: Wrench, color: 'text-teal-secondary' },
                { name: 'Udhampur Main', value: 86, icon: DollarSign, color: 'text-emerald-600' },
              ].map((item, idx) => (
                <div key={idx} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-teal-50 group-hover:text-teal-600 transition-colors">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <span className="text-sm font-bold text-slate-700">{item.name}</span>
                  </div>
                  <span className="text-sm font-black text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Colorful CTA Card */}
          <Card className="border-none bg-gradient-to-br from-teal-600 to-teal-800 rounded-[2rem] p-8 shadow-2xl shadow-teal-200 relative overflow-hidden group">
            <div className="absolute -right-10 -bottom-10 h-64 w-64 rounded-full bg-white/10 blur-3xl group-hover:scale-125 transition-transform duration-700" />
            <div className="relative z-10 h-full flex flex-col">
              <h3 className="text-5xl font-black text-white tracking-tighter mb-2">3,240</h3>
              <p className="text-sm font-bold text-white/70 uppercase tracking-widest mb-10">Monthly Targets Reached</p>

              <div className="mt-auto">
                <div className="h-20 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timelineData}>
                      <Line type="monotone" dataKey="value" stroke="rgba(255,255,255,0.6)" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between mt-4">
                  {[14, 15, 16, 17, 18, 19].map(n => (
                    <span key={n} className="text-[10px] font-bold text-white/50">{n}</span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </MainLayout>
  )
}

import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
