'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CircleMarker, LatLngBounds, LayerGroup, Map as LeafletMap, TileLayer } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, Layers, MapPin, Maximize2, Minimize2, Minus, Navigation, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Leaflet is imported inside an effect because it touches `window` at module scope. @types/leaflet
 * declares no `default` export, so the namespace type is taken from this loader rather than written
 * out by hand — `(typeof import('leaflet'))['default']` does not type-check even though the value
 * exists at runtime through esModuleInterop.
 */
async function loadLeaflet() {
  return (await import('leaflet')).default
}
type LeafletApi = Awaited<ReturnType<typeof loadLeaflet>>

export type MapStyleKey = 'streets' | 'hot' | 'canvas' | 'satellite'

export const MAP_STYLES: Record<
  MapStyleKey,
  { label: string; url: string; subdomains: string[]; maxZoom: number; attribution: string }
> = {
  streets: {
    label: 'Modern Streets',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    subdomains: [],
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.esri.com">Esri</a> &mdash; DeLorme, NAVTEQ, TomTom',
  },
  hot: {
    label: 'Humanitarian OSM',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/">HOT</a>',
  },
  canvas: {
    label: 'Clean Light',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    subdomains: [],
    maxZoom: 16,
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: [],
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
  },
}

/**
 * Where each demo car last reported, on a map you can actually work with.
 *
 * ── The honesty problem this component is built around ──────────────────────────────────────────
 * A pin looks like a fact. It is not: it is where the car's tracker last managed to report, and a
 * parked demo car's unit sleeps. Measured on the live fleet (2026-09-12) the eleven stored fixes were
 * 1h, 3h, 48h, 52h, 117h, 124h, 337h, 2314h, 7027h and 11953h old, plus one car with no fix at all —
 * so a map that renders every pin identically would place a car at a showroom it left 498 days ago.
 *
 * ⚠️ So AGE decides how a pin is drawn, the age is written next to every car in the list, and a car
 * with no fix at all still gets a row saying so. A fix is 'live' only within POSITION_LIVE_WINDOW_MS
 * (10 minutes, lib/loconav/positions.ts); everything else is explicitly "last seen", never "is here".
 *
 * ⚠️ Inline colours, not Tailwind classes: app/globals.css retints emerald/amber/rose utilities to
 * theme tokens with !important, so bg-emerald-500 does not render emerald here. The rest of this
 * section already does the same — see STATE_STYLE in fleet-panel.tsx.
 *
 * ── Why the map is built once and the markers are rebuilt ───────────────────────────────────────
 * The fleet refetches every 60 seconds. Tearing the Leaflet map down on each refetch threw away the
 * viewer's pan, zoom and selection every minute — you could not keep one car in view long enough to
 * look at it. So: one effect owns the map for the lifetime of the component, a second owns the
 * markers, and the view is fitted ONCE rather than on every data arrival.
 *
 * Leaflet is loaded inside the effect because it touches `window` at import time, which breaks
 * server rendering. OpenStreetMap tiles need no API key; attribution is required by their terms and
 * is rendered by the tile layer.
 */

export type MapVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  color: string | null
  branchLabel: string
  state: 'available' | 'reserved' | 'out'
  driverName: string | null
  overdue: boolean
  tracking: {
    state: 'live' | 'stale' | 'no_fix' | 'untracked' | 'not_configured'
    latitude: number | null
    longitude: number | null
    speedKph: number | null
    address: string | null
    positionAt: string | null
    ageMs: number | null
    subscriptionExpired?: boolean
  }
}

/** Ask this component to show one particular car. `nonce` is what makes a repeat click re-fire. */
export type MapFocus = { vin: string; nonce: number }

const DEFAULT_CENTER: [number, number] = [32.74, 74.83] // Jammu — where the fleet lives.
const DEFAULT_ZOOM = 12
const SELECTED_STROKE = '#4338ca'

/** How old a fix is, in the plainest words that still carry the number. */
function agePhrase(ageMs: number | null): string {
  if (ageMs === null) return 'age unknown'
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`
}

type Look = { fill: string; stroke: string; radius: number; opacity: number; label: string }

/**
 * Four bands, because "live" and "not live" is too blunt for this data: a 40-minute-old fix is worth
 * acting on, a 5-month-old one is a historical note and must not look the same.
 */
function freshness(ageMs: number | null): Look {
  if (ageMs === null) return { fill: '#94a3b8', stroke: '#475569', radius: 6, opacity: 0.5, label: 'Age unknown' }
  const minutes = ageMs / 60000
  if (minutes <= 10) return { fill: '#059669', stroke: '#065f46', radius: 9, opacity: 1, label: 'Live' }
  if (minutes <= 120) return { fill: '#d97706', stroke: '#92400e', radius: 8, opacity: 0.95, label: 'Recent' }
  if (minutes <= 60 * 24) return { fill: '#64748b', stroke: '#334155', radius: 7, opacity: 0.8, label: 'Today' }
  return { fill: '#cbd5e1', stroke: '#64748b', radius: 6, opacity: 0.65, label: 'Old fix' }
}

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ['#059669', 'Live · last 10 min'],
  ['#d97706', 'Within 2 hours'],
  ['#64748b', 'Earlier today'],
  ['#cbd5e1', 'Older than a day'],
]

const STATE_STYLE = {
  available: { bg: '#d1fae5', fg: '#065f46', label: 'Available' },
  reserved: { bg: '#e0e7ff', fg: '#3730a3', label: 'Booked' },
  out: { bg: '#dbeafe', fg: '#1e40af', label: 'Out' },
} as const

const FILTERS = [
  { key: 'all', label: 'All cars' },
  { key: 'out', label: 'Out' },
  { key: 'reserved', label: 'Booked' },
  { key: 'available', label: 'In yard' },
] as const
type FilterKey = (typeof FILTERS)[number]['key']

/** Vehicle text comes from the DMS feed, so it is escaped before going into popup HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function plateOf(v: MapVehicle): string {
  return v.registrationNumber || `VIN …${v.vin.slice(-6)}`
}

function hasPosition(v: MapVehicle): boolean {
  return typeof v.tracking.latitude === 'number' && typeof v.tracking.longitude === 'number'
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function FleetMapCard({
  vehicles,
  isLoading = false,
  focus = null,
  activeTab = 'all',
  dealerFilter = 'all',
  onFocusHandled,
}: {
  vehicles: MapVehicle[]
  isLoading?: boolean
  focus?: MapFocus | null
  activeTab?: string
  dealerFilter?: string
  onFocusHandled?: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedVin, setSelectedVin] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [mapStyle, setMapStyle] = useState<MapStyleKey>('streets')
  const [showStyleMenu, setShowStyleMenu] = useState(false)
  // Flipped once Leaflet has loaded and the map object exists, so the marker effect knows to run.
  const [ready, setReady] = useState(false)

  // Automatically sync map filter when KPI cards or dashboard tabs change
  useEffect(() => {
    if (activeTab === 'out') {
      setFilter('out')
    } else if (activeTab === 'approved') {
      setFilter('reserved')
    } else if (activeTab === 'awaiting') {
      setFilter('all')
    } else if (activeTab === 'all') {
      setFilter('all')
    }
  }, [activeTab])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletApi | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const tileLayerRef = useRef<TileLayer | null>(null)
  const markersRef = useRef(new Map<string, { marker: CircleMarker; look: Look }>())
  const boundsRef = useRef<LatLngBounds | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  /* A view change asked for before the element had a size, to be performed once it has one. */
  const pendingViewRef = useRef(true)
  /* Which cars are on the map right now, so a 60-second refetch of the SAME cars does not re-fit. */
  const plottedKeyRef = useRef('')
  /* The car the view was last moved to, so the same refetch does not fly to it again every minute. */
  const flownToRef = useRef<string | null>(null)
  const listRefs = useRef(new Map<string, HTMLButtonElement>())

  /*
   * A mirror of the selection for the effects and callbacks below, which run outside React's render
   * and would otherwise close over a stale value - the ResizeObserver in particular lives for the
   * whole lifetime of the map.
   */
  const selectedVinRef = useRef<string | null>(null)
  selectedVinRef.current = selectedVin

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return vehicles.filter((v) => {
      // Dealer / Branch filter
      if (dealerFilter && dealerFilter !== 'all') {
        const branchMatch =
          (dealerFilter === 'JK402' && (v.branchLabel.includes('402') || v.branchLabel.toLowerCase().includes('jammu'))) ||
          (dealerFilter === 'JK501' && (v.branchLabel.includes('501') || v.branchLabel.toLowerCase().includes('udhampur'))) ||
          v.branchLabel.toLowerCase().includes(dealerFilter.toLowerCase())
        if (!branchMatch) return false
      }

      // State / Status filter
      if (filter !== 'all' && v.state !== filter) return false

      // Text search query
      if (!needle) return true
      return [v.registrationNumber, v.model, v.color, v.driverName, v.branchLabel, v.vin]
        .some((field) => (field || '').toLowerCase().includes(needle))
    })
  }, [vehicles, query, filter, dealerFilter])

  /* Only the filtered cars are plotted, so narrowing the list narrows the map with it. */
  const plotted = useMemo(() => visible.filter(hasPosition), [visible])
  const trackedTotal = useMemo(() => vehicles.filter(hasPosition).length, [vehicles])
  const liveTotal = useMemo(
    () => vehicles.filter((v) => hasPosition(v) && (v.tracking.ageMs ?? Infinity) <= 10 * 60_000).length,
    [vehicles],
  )

  const selected = useMemo(
    () => (selectedVin ? vehicles.find((v) => v.vin === selectedVin) ?? null : null),
    [vehicles, selectedVin],
  )

  /**
   * Put the map where it should be: on the chosen car if there is one, otherwise on the whole fleet.
   */
  const applyView = useCallback((animate: boolean) => {
    const map = mapRef.current
    const el = containerRef.current
    if (!map || !el) return
    if (el.clientWidth === 0) {
      pendingViewRef.current = true
      return
    }
    map.invalidateSize({ pan: false, animate: false })
    pendingViewRef.current = false

    const vin = selectedVinRef.current
    const entry = vin ? markersRef.current.get(vin) : undefined
    if (entry) {
      const target = entry.marker.getLatLng()
      const zoom = Math.max(map.getZoom(), 15)
      if (animate && !prefersReducedMotion()) map.flyTo(target, zoom, { duration: 0.6 })
      else map.setView(target, zoom)
      entry.marker.openPopup()
      return
    }
    const bounds = boundsRef.current
    if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  }, [])

  // ── The map itself: created once, kept for the life of the component ────────────────────────────
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = await loadLeaflet()
      if (cancelled || !containerRef.current || mapRef.current) return

      /*
       * Modern Map with high-DPI retina tiles, smooth sub-pixel zoom snapping, and full 2-finger touch support.
       */
      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        dragging: true,
        bounceAtZoomLimits: false,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        zoomControl: false,
        attributionControl: true,
      }).setView(DEFAULT_CENTER, DEFAULT_ZOOM)

      const conf = MAP_STYLES.streets
      const tileLayer = L.tileLayer(conf.url, {
        maxZoom: conf.maxZoom,
        subdomains: conf.subdomains.length > 0 ? conf.subdomains : 'abc',
        attribution: conf.attribution,
      }).addTo(map)

      tileLayerRef.current = tileLayer
      leafletRef.current = L
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)

      const observer = new ResizeObserver(() => {
        const m = mapRef.current
        const el = containerRef.current
        if (!m || !el || el.clientWidth === 0) return
        applyView(false)
      })
      observer.observe(containerRef.current)
      observerRef.current = observer

      setReady(true)
    })()

    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      observerRef.current = null
      markersRef.current.clear()
      layerRef.current = null
      tileLayerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [applyView])

  // ── Map Style Swapping ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!ready || !L || !map) return

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current)
    }

    const conf = MAP_STYLES[mapStyle]
    const tileLayer = L.tileLayer(conf.url, {
      maxZoom: conf.maxZoom,
      subdomains: conf.subdomains.length > 0 ? conf.subdomains : 'abc',
      attribution: conf.attribution,
    })
    tileLayer.addTo(map)
    tileLayerRef.current = tileLayer

    // Ensure tile layer sits at the back beneath vehicle markers
    tileLayer.bringToBack()
    for (const [, entry] of markersRef.current) {
      entry.marker.bringToFront()
    }
  }, [mapStyle, ready])

  // ── Two-Finger Trackpad Pinch-to-Zoom & Ctrl+Scroll Support ────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el || !ready) return

    const handleWheel = (e: WheelEvent) => {
      const map = mapRef.current
      if (!map) return

      // Two-finger trackpad pinch (browser sends e.ctrlKey: true) or Ctrl+MouseWheel
      if (e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        const delta = -e.deltaY * 0.015
        const currentZoom = map.getZoom()
        const newZoom = Math.min(Math.max(currentZoom + delta, 3), 20)

        const rect = el.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        const L = leafletRef.current
        if (L) {
          const mousePoint = L.point(mouseX, mouseY)
          const mouseLatLng = map.containerPointToLatLng(mousePoint)
          map.setZoomAround(mouseLatLng, newZoom, { animate: false })
        } else {
          map.setZoom(newZoom, { animate: false })
        }
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
    }
  }, [ready])

  // ── The markers: rebuilt whenever the plotted set changes, without touching the map ─────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!ready || !L || !map || !layer) return

    layer.clearLayers()
    markersRef.current.clear()

    const points: [number, number][] = []
    for (const v of plotted) {
      const lat = v.tracking.latitude as number
      const lng = v.tracking.longitude as number
      points.push([lat, lng])
      const look = freshness(v.tracking.ageMs)
      const name = escapeHtml(plateOf(v))
      const detail = escapeHtml([v.model, v.color].filter(Boolean).join(' · '))
      const speed = v.tracking.speedKph && v.tracking.speedKph > 1
        ? `Moving · ${Math.round(v.tracking.speedKph)} km/h`
        : 'Stopped'
      const where = v.tracking.address ? `<div style="color:#475569">${escapeHtml(v.tracking.address)}</div>` : ''

      const marker = L.circleMarker([lat, lng], {
        radius: look.radius,
        color: look.stroke,
        fillColor: look.fill,
        fillOpacity: look.opacity,
        weight: 2,
      })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.5;min-width:190px">
            <div style="font-weight:700;color:#0f172a">${name}</div>
            ${detail ? `<div style="color:#64748b">${detail}</div>` : ''}
            <div style="margin-top:6px;color:#0f172a">${escapeHtml(STATE_STYLE[v.state].label)}${v.overdue ? ' · <strong style="color:#b91c1c">overdue</strong>' : ''}${v.driverName ? ` · ${escapeHtml(v.driverName)}` : ''}</div>
            <div style="color:#475569">${speed}</div>
            ${where}
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;color:#475569">
              <strong>${escapeHtml(look.label)}</strong> — last reported ${escapeHtml(agePhrase(v.tracking.ageMs))}
            </div>
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noreferrer"
               style="display:inline-block;margin-top:6px;color:#4338ca;font-weight:600">Open in Google Maps</a>
          </div>`,
        )
        .on('click', () => setSelectedVin(v.vin))

      marker.addTo(layer)
      markersRef.current.set(v.vin, { marker, look })
    }

    if (points.length === 0) {
      boundsRef.current = null
      plottedKeyRef.current = ''
      return
    }
    boundsRef.current = L.latLngBounds(points)
    /*
     * ⚠️ Re-fit only when the SET of plotted cars changed — never on every data arrival. The fleet
     * refetches every 60 seconds with the same cars in it, and re-fitting there yanked the view back
     * out to the whole fleet while somebody was reading one pin. Changing a filter does change the
     * set, and that is exactly when a re-fit is wanted.
     */
    const key = plotted.map((v) => v.vin).join('|')
    const setChanged = key !== plottedKeyRef.current
    plottedKeyRef.current = key
    if (pendingViewRef.current || setChanged) applyView(false)
  }, [ready, plotted, applyView])

  // ── Selection: restyle every pin, fly to the chosen one ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    for (const [vin, entry] of markersRef.current) {
      const isSelected = vin === selectedVin
      entry.marker.setStyle({
        color: isSelected ? SELECTED_STROKE : entry.look.stroke,
        weight: isSelected ? 4 : 2,
        fillOpacity: isSelected ? 1 : entry.look.opacity,
      })
      entry.marker.setRadius(isSelected ? entry.look.radius + 4 : entry.look.radius)
      if (isSelected) entry.marker.bringToFront()
    }

    if (!selectedVin) {
      flownToRef.current = null
      return
    }
    /*
     * Move the view only when the CHOSEN CAR changed. This effect also re-runs on every 60-second
     * refetch (the markers are rebuilt), and flying again there would drag the viewer back to the pin
     * every minute even after they had deliberately panned away from it.
     */
    if (flownToRef.current === selectedVin) return
    flownToRef.current = selectedVin
    applyView(true)
  }, [selectedVin, ready, plotted, applyView])

  /*
   * Drop the selection when a filter or a search has taken that car out of the list. Left alone, the
   * strip under the map went on describing a car that was no longer anywhere on the screen, and the
   * map stayed flown in on a pin it was no longer drawing.
   */
  useEffect(() => {
    if (!selectedVin || visible.some((v) => v.vin === selectedVin)) return
    setSelectedVin(null)
    selectedVinRef.current = null
    flownToRef.current = null
  }, [visible, selectedVin])

  // Keep the chosen car visible in the list even when it was picked on the map.
  useEffect(() => {
    if (!selectedVin) return
    listRefs.current.get(selectedVin)?.scrollIntoView({ block: 'nearest' })
  }, [selectedVin])

  /*
   * Wheel zoom is ON in full screen and OFF in the card. In the card the wheel belongs to the page —
   * a map that swallows it traps the reader halfway down the screen.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (fullscreen) map.scrollWheelZoom.enable()
    else map.scrollWheelZoom.disable()
  }, [fullscreen, ready])

  // ── Full screen: an overlay, so it works inside the app shell and on every browser ──────────────
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [fullscreen])

  /*
   * A car asked for from elsewhere on the page (a gate pass row). Filters are cleared first, or the
   * requested car could be filtered out of the very view that was opened to show it.
   */
  const focusNonce = focus?.nonce
  const focusVin = focus?.vin
  useEffect(() => {
    if (!focusVin) return
    setQuery('')
    setFilter('all')
    setSelectedVin(focusVin)
    setFullscreen(true)
    /*
     * Written straight to the refs as well as to state: asking for the SAME car twice does not change
     * `selectedVin`, so the selection effect would never re-run and the second click would do nothing.
     */
    selectedVinRef.current = focusVin
    flownToRef.current = focusVin
    pendingViewRef.current = true
    applyView(true)
    onFocusHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the nonce is the trigger; re-running on
    // a new onFocusHandled identity would re-open the overlay the viewer just closed.
  }, [focusVin, focusNonce])

  const showAll = useCallback(() => {
    setSelectedVin(null)
    selectedVinRef.current = null
    flownToRef.current = null
    applyView(false)
  }, [applyView])

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn(1)
  }, [])

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut(1)
  }, [])

  const headline = isLoading
    ? 'Loading positions…'
    : trackedTotal === 0
      ? 'No car has reported a position yet'
      : `${trackedTotal} of ${vehicles.length} cars have reported · ${liveTotal} live now`

  return (
    <section
      aria-label="Demo fleet vehicle locations"
      className={
        fullscreen
          ? 'fixed inset-0 z-[70] flex flex-col overflow-hidden bg-white dark:bg-slate-900'
          : 'isolate flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900'
      }
    >
      {/* ── Header ────────────────────────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-indigo-900/50 dark:bg-indigo-950/60 dark:text-indigo-400">
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Where the cars are
            </h2>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{headline}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a car"
              aria-label="Find a car by plate, model or driver"
              className="h-9 w-40 rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-48"
            />
          </div>

          <div className="flex items-center rounded-xl border border-slate-200 p-0.5 dark:border-slate-700">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={
                  filter === f.key
                    ? 'rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white'
                    : 'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={showAll}
            title="Zoom out to every car"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Crosshair className="h-3.5 w-3.5" /> Show all
          </button>

          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>
      </div>

      {/* ── List + map ────────────────────────────────────────────────────────────────────────── */}
      <div className={fullscreen ? 'flex min-h-0 flex-1 flex-col lg:flex-row' : 'flex flex-col lg:flex-row'}>
        {/* The car list. On a phone it sits under the map; on a desktop it is the left rail. */}
        <div
          className={
            fullscreen
              ? 'order-2 flex max-h-[38%] min-h-0 flex-col border-t border-slate-100 dark:border-slate-800 lg:order-1 lg:max-h-none lg:w-72 lg:shrink-0 lg:border-r lg:border-t-0'
              : 'order-2 flex shrink-0 flex-col border-t border-slate-100 dark:border-slate-800 lg:order-1 lg:w-72 lg:border-r lg:border-t-0'
          }
        >
          <div className="flex shrink-0 items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>{visible.length} {visible.length === 1 ? 'car' : 'cars'}</span>
            {selectedVin ? (
              <button
                type="button"
                onClick={() => setSelectedVin(null)}
                className="inline-flex items-center gap-1 rounded normal-case text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            ) : null}
          </div>

          <div className={fullscreen ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-[260px] overflow-y-auto lg:max-h-[440px]'}>
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400">
                {isLoading ? 'Loading the fleet…' : 'No car matches that search.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                {visible.map((v) => {
                  const look = freshness(v.tracking.ageMs)
                  const positioned = hasPosition(v)
                  const isSelected = v.vin === selectedVin
                  return (
                    <li key={v.vin}>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) listRefs.current.set(v.vin, el)
                          else listRefs.current.delete(v.vin)
                        }}
                        onClick={() => setSelectedVin(isSelected ? null : v.vin)}
                        aria-pressed={isSelected}
                        className={
                          'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ' +
                          (isSelected
                            ? 'bg-indigo-50 dark:bg-indigo-950/40'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')
                        }
                      >
                        <span
                          aria-hidden
                          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-900"
                          style={{ backgroundColor: positioned ? look.fill : '#e2e8f0' }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                              {plateOf(v)}
                            </span>
                            {v.overdue ? (
                              <span className="shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase"
                                style={{ backgroundColor: '#ffe4e6', color: '#9f1239' }}>
                                Overdue
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="truncate">{v.model || 'Model not recorded'}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {positioned ? `${look.label} · ${agePhrase(v.tracking.ageMs)}` : noFixPhrase(v)}
                          </span>
                        </span>
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ backgroundColor: STATE_STYLE[v.state].bg, color: STATE_STYLE[v.state].fg }}
                        >
                          {STATE_STYLE[v.state].label}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* The map, with the legend floating over it rather than eating a strip below it. */}
        <div
          className={
            fullscreen
              ? 'relative order-1 min-h-0 flex-1 lg:order-2'
              : 'relative order-1 h-[300px] w-full lg:order-2 lg:h-[440px] lg:flex-1'
          }
          style={{ background: '#eef2f7' }}
        >
          <div ref={containerRef} className="absolute inset-0" style={{ touchAction: 'none' }} />

          {/* Floating Modern Map Controls */}
          <div className="absolute right-3 top-3 z-[650] flex flex-col items-end gap-2">
            {/* Style Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowStyleMenu((v) => !v)}
                title="Change map style"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/95 px-2.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-sm hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
              >
                <Layers className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>{MAP_STYLES[mapStyle].label}</span>
              </button>

              {showStyleMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setMapStyle(key)
                        setShowStyleMenu(false)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                        mapStyle === key
                          ? 'bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      <span>{MAP_STYLES[key].label}</span>
                      {mapStyle === key && <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Modern Zoom & Recenter Control Stack */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom in"
                className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
              </button>
              <div className="h-px bg-slate-200 dark:bg-slate-700" />
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom out"
                className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="h-px bg-slate-200 dark:bg-slate-700" />
              <button
                type="button"
                onClick={showAll}
                title="Reset view to whole fleet"
                className="flex h-8 w-8 items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Crosshair className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Pinch-to-zoom badge on bottom right */}
          <div className="pointer-events-none absolute bottom-3 right-3 z-[650] hidden sm:block rounded-xl border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[10px] font-medium text-slate-500 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400">
            Pinch with 2 fingers or Ctrl + scroll to zoom
          </div>

          {plotted.length === 0 && !isLoading ? (
            <div className="pointer-events-none absolute inset-0 z-[650] flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-xs rounded-xl border border-slate-200 bg-white/95 p-4 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {vehicles.length === 0 ? 'No cars to show.' : 'Nothing to plot here.'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  A car appears once its tracker is linked and has reported a fix. Exact positions are
                  visible to gate pass approvers only.
                </p>
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute bottom-3 left-3 z-[650] rounded-xl border border-slate-200 bg-white/92 px-2.5 py-2 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/92">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Last reported</p>
              <ul className="space-y-0.5">
                {LEGEND.map(([colour, label]) => (
                  <li key={label} className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour }} />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── The selected car, and the sentence that keeps a pin honest ────────────────────────── */}
      <div className="shrink-0 border-t border-slate-100 dark:border-slate-800">
        {selected ? (
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{plateOf(selected)}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {[selected.model, selected.color, selected.branchLabel].filter(Boolean).join(' · ')}
              </p>
            </div>

            {hasPosition(selected) ? (
              <>
                <Fact label="Last reported">
                  <span style={{ color: freshness(selected.tracking.ageMs).stroke }} className="font-semibold">
                    {freshness(selected.tracking.ageMs).label}
                  </span>
                  <span className="text-slate-500"> · {agePhrase(selected.tracking.ageMs)}</span>
                </Fact>
                <Fact label="Motion">
                  {selected.tracking.speedKph && selected.tracking.speedKph > 1 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200">
                      <Navigation className="h-3 w-3" /> {Math.round(selected.tracking.speedKph)} km/h
                    </span>
                  ) : (
                    <span className="text-slate-600 dark:text-slate-300">Stopped</span>
                  )}
                </Fact>
                {selected.tracking.address ? (
                  <Fact label="Near">
                    <span className="text-slate-600 dark:text-slate-300">{selected.tracking.address}</span>
                  </Fact>
                ) : null}
                <a
                  href={`https://www.google.com/maps?q=${selected.tracking.latitude},${selected.tracking.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto shrink-0 self-center rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-slate-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                >
                  Open in Google Maps
                </a>
              </>
            ) : (
              <Fact label="Position">
                <span className="text-slate-600 dark:text-slate-300">{noFixPhrase(selected)}</span>
              </Fact>
            )}
          </div>
        ) : null}

        {/*
          * Said once, in words: a pin is the last REPORT, not a live location. Without this line a
          * manager reads an old pin as "the car is there now" — the single most expensive mistake
          * this screen can cause.
          */}
        <p className="px-4 pb-3 pt-1 text-[11px] text-slate-400">
          Each pin is where that car last reported. A parked car&apos;s tracker sleeps, so an older fix
          does not mean the car is still there — check the age before acting on it.
        </p>
      </div>
    </section>
  )
}

/** Why there is no pin, in the tracker's own terms — never a blank that reads as "not moving". */
function noFixPhrase(v: MapVehicle): string {
  if (v.tracking.subscriptionExpired) return 'Tracker subscription lapsed'
  switch (v.tracking.state) {
    case 'untracked': return 'No tracker fitted'
    case 'no_fix': return 'Tracker fitted, no fix yet'
    case 'not_configured': return 'Tracking not set up'
    default: return 'Position hidden — approvers only'
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-xs">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-xs">{children}</p>
    </div>
  )
}
