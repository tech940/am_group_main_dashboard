'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CircleMarker, LatLngBounds, LayerGroup, Map as LeafletMap, Polyline, TileLayer } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers, Maximize2, Minimize2, Route, TriangleAlert } from 'lucide-react'
import { INDIA_TIME_ZONE } from '@/lib/date-time'
import { classifyMovement } from '@/lib/loconav/timeline'
import { journeyBounds, segmentPoints, type LatLng } from '@/lib/loconav/polyline'
/* One definition, in the file that owns MAP_STYLES — a second copy would drift to another provider. */
import { MAP_STYLES, SATELLITE_LABELS_URL, type MapStyleKey } from './fleet-map'

/*
 * Leaflet touches `window` at module scope, so it is imported inside the effect. @types/leaflet
 * declares no `default` export, hence taking the namespace type from the loader.
 */
async function loadLeaflet() {
  return (await import('leaflet')).default
}
type LeafletApi = Awaited<ReturnType<typeof loadLeaflet>>

/**
 * One demo drive, from gate out to gate in: where the car went, and when it was where.
 *
 * ── What the provider actually gives, and what that forces ───────────────────────────────────────
 * The drive arrives as a list of segments, each one `Moving`, `Stopped`, `Idling` or `Offline`.
 * Measured across the 8 reconciled drives on this account (2026-09-15), only `Moving` segments carry
 * a route; `Stopped` and `Idling` carry a single end coordinate and no address at all; `Offline`
 * carries two endpoints and no road between them.
 *
 * ⚠️ AN OFFLINE STRETCH IS NOT A ROUTE. The unit lost signal or power and the car may well have been
 * driving. Its two endpoints are known and the road between them is not, so it is drawn as a DASHED
 * line and named as a gap in the record. Drawing it like the rest would invent a journey — the single
 * most misleading thing this screen could do, because that invented line is what somebody would use
 * to say a driver did or did not go somewhere.
 *
 * ⚠️ `Idling` is kept apart from `Stopped`. Engine running and not moving is a different fact from
 * parked, and lib/loconav/timeline.ts already refuses to merge them.
 *
 * ⚠️ Inline colours, not Tailwind classes: app/globals.css retints emerald/amber/rose utilities to
 * theme tokens with !important, so bg-amber-500 does not render amber here.
 *
 * ⚠️ This component only ever renders what the caller was given. The route is redacted to [] for
 * anyone without gate_pass.approve in app/api/gate-pass/[id]/route.ts — a drive is a record of where
 * a named customer went, so that redaction is the point and must not be worked around here.
 */

export type JourneySegment = {
  movementStatus: string | null
  distanceKm: number | null
  averageSpeedKph: number | null
  path: string | null
  startTsMs: number | null
  endTsMs: number | null
  startAddress: string | null
  endAddress: string | null
  startCoordinates: string | null
  endCoordinates: string | null
}

const STYLE = {
  moving: { line: '#4338ca', dot: '#4338ca', label: 'Driving' },
  stopped: { line: '#64748b', dot: '#64748b', label: 'Stopped' },
  idling: { line: '#d97706', dot: '#d97706', label: 'Idling' },
  offline: { line: '#94a3b8', dot: '#94a3b8', label: 'Tracker offline' },
  unknown: { line: '#cbd5e1', dot: '#cbd5e1', label: 'Unknown' },
} as const

const START_COLOUR = '#059669'
const END_COLOUR = '#b91c1c'

type Kind = keyof typeof STYLE

/** 'Idling' is its own kind here, though lib/loconav/timeline.ts groups it with stopped for totals. */
function kindOf(segment: JourneySegment): Kind {
  const raw = String(segment.movementStatus ?? '').trim().toLowerCase()
  if (raw === 'idling') return 'idling'
  const klass = classifyMovement(segment.movementStatus)
  if (klass === 'moving') return 'moving'
  if (klass === 'offline') return 'offline'
  if (klass === 'stationary') return 'stopped'
  return 'unknown'
}

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: INDIA_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: INDIA_TIME_ZONE,
  day: '2-digit',
  month: 'short',
})

function clockOf(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--'
  return timeFormatter.format(new Date(ms))
}

function dayOf(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null
  return dayFormatter.format(new Date(ms))
}

function durationOf(segment: JourneySegment): string {
  const { startTsMs, endTsMs } = segment
  if (startTsMs === null || endTsMs === null) return ''
  const seconds = Math.max(0, Math.round((endTsMs - startTsMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Vehicle and street text comes from the provider, so it is escaped before entering popup HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export function JourneyMap({ segments }: { segments: JourneySegment[] }) {
  const [fullscreen, setFullscreen] = useState(false)
  /* Satellite by default: on a demo drive the useful question is which gate, forecourt or house the
     car actually stopped at, and a street basemap draws a blank rectangle where that answer is. */
  const [mapStyle, setMapStyle] = useState<MapStyleKey>('satellite')
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletApi | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const tileLayerRef = useRef<TileLayer | null>(null)
  const labelLayerRef = useRef<TileLayer | null>(null)
  /*
   * `casing` is the white line drawn UNDER a coloured one. Over satellite imagery a 4px indigo stroke
   * disappears into dark trees and wet tarmac; the halo is what keeps the route legible on any
   * basemap, and it is the reason this map can default to imagery at all.
   */
  const drawnRef = useRef(new Map<number, { shape: Polyline | CircleMarker; casing: Polyline | null; points: LatLng[] }>())
  const boundsRef = useRef<LatLngBounds | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const pendingViewRef = useRef(true)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const stylePickerRef = useRef<HTMLDivElement | null>(null)

  const selectedRef = useRef<number | null>(null)
  selectedRef.current = selected

  const plottable = useMemo(() => journeyBounds(segments).length > 0, [segments])

  const totals = useMemo(() => {
    let km = 0
    let stops = 0
    let offlineSeconds = 0
    for (const segment of segments) {
      const kind = kindOf(segment)
      if (kind === 'moving' && typeof segment.distanceKm === 'number') km += segment.distanceKm
      if (kind === 'stopped') stops += 1
      if (kind === 'offline' && segment.startTsMs !== null && segment.endTsMs !== null) {
        offlineSeconds += Math.max(0, (segment.endTsMs - segment.startTsMs) / 1000)
      }
    }
    return { km, stops, offlineMinutes: Math.round(offlineSeconds / 60) }
  }, [segments])

  /**
   * Put the map where it should be: on the chosen leg if there is one, otherwise on the whole drive.
   *
   * ⚠️ Driven by the container REPORTING A SIZE, and re-applied on every resize. fitBounds against a
   * zero-width element returns maximum zoom, and invalidateSize alone keeps the old zoom while
   * revealing more ground — opening full screen after a fit would otherwise leave the drive as a
   * smudge in one corner.
   */
  const applyView = useCallback((animate: boolean) => {
    const L = leafletRef.current
    const map = mapRef.current
    const el = containerRef.current
    if (!L || !map || !el) return
    if (el.clientWidth === 0) {
      pendingViewRef.current = true
      return
    }
    // { pan: false } — the view is set explicitly two lines down, and the default pan races it.
    map.invalidateSize({ pan: false, animate: false })
    pendingViewRef.current = false

    const index = selectedRef.current
    const entry = index === null ? undefined : drawnRef.current.get(index)
    if (entry && entry.points.length > 0) {
      if (entry.points.length === 1) map.setView(entry.points[0], Math.max(map.getZoom(), 16))
      else map.fitBounds(L.latLngBounds(entry.points), { padding: [48, 48], maxZoom: 17, animate })
      return
    }
    if (boundsRef.current) map.fitBounds(boundsRef.current, { padding: [36, 36], maxZoom: 16 })
  }, [])

  // ── The map: created once and kept, so redrawing legs never costs the viewer their zoom ─────────
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = await loadLeaflet()
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true })
        .setView([32.74, 74.83], 12)

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
      drawnRef.current.clear()
      tileLayerRef.current = null
      labelLayerRef.current = null
      layerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [applyView])

  /* A dropdown that only closes by picking something is a trap on a phone, where there is no Escape. */
  useEffect(() => {
    if (!stylePickerOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!stylePickerRef.current?.contains(e.target as Node)) setStylePickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation() // Escape closes the menu, not the gate pass dialog behind it.
      setStylePickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [stylePickerOpen])

  // ── The basemap, swapped without touching the drive drawn on top of it ──────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!ready || !L || !map) return

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)
    if (labelLayerRef.current) map.removeLayer(labelLayerRef.current)
    labelLayerRef.current = null

    const conf = MAP_STYLES[mapStyle]
    const tiles = L.tileLayer(conf.url, {
      maxZoom: conf.maxZoom,
      subdomains: conf.subdomains,
      attribution: conf.attribution,
    })
    tiles.addTo(map)
    /* Behind the route, always — a basemap added after the drive would paint over it. */
    tiles.bringToBack()
    tileLayerRef.current = tiles

    if (mapStyle === 'satellite') {
      const labels = L.tileLayer(SATELLITE_LABELS_URL, { maxZoom: conf.maxZoom, subdomains: [] })
      labels.addTo(map)
      labels.bringToBack()
      tiles.bringToBack() // imagery underneath, labels above it, the drive above both.
      labelLayerRef.current = labels
    }
  }, [mapStyle, ready])

  // ── The drive itself ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!ready || !L || !map || !layer) return

    layer.clearLayers()
    drawnRef.current.clear()

    const all: LatLng[] = []
    let firstPoint: LatLng | null = null
    let lastPoint: LatLng | null = null

    segments.forEach((segment, index) => {
      const kind = kindOf(segment)
      const style = STYLE[kind]
      const { points, kind: geometry } = segmentPoints(segment)
      if (points.length === 0) return
      /*
       * ⚠️ 'straight' geometry is only an UNRECORDED road when the tracker was offline.
       *
       * Measured 2026-09-15: four Moving legs of 70-130 m came back as a path holding a single
       * sample, so they fall through to their two endpoints and look 'straight' — but the tracker was
       * working perfectly and a straight line across 70 m is what the data is. Dashing those and
       * captioning them "road not recorded" would report an outage that never happened. Every decoded
       * route is straight lines between samples anyway; only Offline means nobody was watching.
       */
      const unrecorded = kind === 'offline' && geometry === 'straight'
      all.push(...points)
      if (!firstPoint) firstPoint = points[0]
      lastPoint = points[points.length - 1]

      const where = segment.startAddress || segment.endAddress
      const popup =
        `<div style="font-size:12px;line-height:1.5;min-width:180px">
          <div style="font-weight:700;color:#0f172a">${escapeHtml(style.label)}</div>
          <div style="color:#475569">${escapeHtml(clockOf(segment.startTsMs))} – ${escapeHtml(clockOf(segment.endTsMs))} · ${escapeHtml(durationOf(segment))}</div>
          ${kind === 'moving' && typeof segment.distanceKm === 'number'
            ? `<div style="color:#475569">${segment.distanceKm.toFixed(2)} km${segment.averageSpeedKph ? ` · avg ${Math.round(segment.averageSpeedKph)} km/h` : ''}</div>`
            : ''}
          ${where ? `<div style="margin-top:4px;color:#64748b">${escapeHtml(where)}</div>` : ''}
          ${unrecorded
            ? '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;color:#92400e">Straight line — the tracker was offline, so the road taken is not recorded.</div>'
            : ''}
        </div>`

      let shape: Polyline | CircleMarker
      let casing: Polyline | null = null
      if (points.length === 1) {
        shape = L.circleMarker(points[0], {
          radius: kind === 'stopped' || kind === 'idling' ? 6 : 5,
          color: '#ffffff',
          weight: 2,
          fillColor: style.dot,
          fillOpacity: 1,
        })
      } else {
        /* The halo first, so the coloured line lands on top of it. */
        casing = L.polyline(points, {
          color: '#ffffff',
          weight: unrecorded ? 6 : 8,
          opacity: 0.85,
          lineCap: 'round',
          interactive: false,
        })
        casing.addTo(layer)
        shape = L.polyline(points, {
          color: style.line,
          weight: unrecorded ? 3 : 4,
          opacity: unrecorded ? 0.85 : 1,
          /* A guessed line is dashed. It must never look like a measured one. */
          dashArray: unrecorded ? '6 8' : undefined,
          lineCap: 'round',
        })
      }
      shape.bindPopup(popup).on('click', () => setSelected(index))
      shape.addTo(layer)
      drawnRef.current.set(index, { shape, casing, points })
    })

    /* Where the drive began and ended, marked apart from the legs so they read at a glance. */
    if (firstPoint) {
      L.circleMarker(firstPoint, { radius: 8, color: '#ffffff', weight: 3, fillColor: START_COLOUR, fillOpacity: 1 })
        .bindPopup('<div style="font-size:12px;font-weight:700;color:#065f46">Start of the drive</div>')
        .addTo(layer)
    }
    if (lastPoint && lastPoint !== firstPoint) {
      L.circleMarker(lastPoint, { radius: 8, color: '#ffffff', weight: 3, fillColor: END_COLOUR, fillOpacity: 1 })
        .bindPopup('<div style="font-size:12px;font-weight:700;color:#991b1b">End of the drive</div>')
        .addTo(layer)
    }

    boundsRef.current = all.length > 0 ? L.latLngBounds(all) : null
    applyView(false)
  }, [ready, segments, applyView])

  // ── Selecting a leg ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    for (const [index, entry] of drawnRef.current) {
      const isSelected = index === selected
      if (entry.points.length > 1) {
        entry.casing?.setStyle({ weight: isSelected ? 11 : 8 })
        entry.shape.setStyle({ weight: isSelected ? 7 : 4, opacity: 1 })
      }
      if (isSelected) {
        entry.casing?.bringToFront()
        entry.shape.bringToFront()
      }
    }
    if (selected === null) return
    applyView(true)
    drawnRef.current.get(selected)?.shape.openPopup()
  }, [selected, ready, segments, applyView])

  useEffect(() => {
    if (selected === null) return
    rowRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // Full screen as an overlay: it works inside the app shell and inside this dialog, unlike the
  // browser Fullscreen API, which a dialog's own stacking context fights.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation() // Escape closes the journey, not the gate pass dialog behind it.
        setFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fullscreen])

  if (segments.length === 0) return null

  return (
    <section
      aria-label="Journey"
      className={
        fullscreen
          ? 'fixed inset-0 z-[80] flex flex-col overflow-hidden bg-white'
          : 'isolate flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs'
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600">
            <Route className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">The journey</h3>
            <p className="truncate text-[11px] text-slate-500">
              {totals.km > 0 ? `${totals.km.toFixed(1)} km · ` : ''}
              {segments.length} {segments.length === 1 ? 'leg' : 'legs'}
              {totals.stops > 0 ? ` · ${totals.stops} ${totals.stops === 1 ? 'stop' : 'stops'}` : ''}
              {totals.offlineMinutes > 0 ? ` · ${totals.offlineMinutes} min with the tracker offline` : ''}
            </p>
          </div>
        </div>
        <div ref={stylePickerRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setStylePickerOpen((v) => !v)}
            aria-expanded={stylePickerOpen}
            aria-haspopup="menu"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Layers className="h-3.5 w-3.5 text-slate-500" />
            {MAP_STYLES[mapStyle].label}
          </button>
          {stylePickerOpen ? (
            <div role="menu" className="absolute right-0 z-[700] mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mapStyle === key}
                  onClick={() => { setMapStyle(key); setStylePickerOpen(false) }}
                  className={
                    'flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold ' +
                    (mapStyle === key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50')
                  }
                >
                  {MAP_STYLES[key].label}
                  {mapStyle === key ? <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          aria-pressed={fullscreen}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      <div className={fullscreen ? 'flex min-h-0 flex-1 flex-col lg:flex-row' : 'flex flex-col lg:flex-row'}>
        {/* The map. Its own className is a CONSTANT — Leaflet writes its classes onto this element
            and React sets `class` wholesale, so a conditional here blanks the map. Size lives above. */}
        <div
          className={
            fullscreen
              ? 'relative order-1 min-h-0 flex-1 lg:order-2'
              : 'relative order-1 h-[280px] w-full lg:order-2 lg:h-[380px] lg:flex-1'
          }
          style={{ background: '#eef2f7' }}
        >
          <div ref={containerRef} className="absolute inset-0" />
          {!plottable ? (
            <div className="pointer-events-none absolute inset-0 z-[650] flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-xs rounded-xl border border-slate-200 bg-white/95 p-4 text-center shadow-sm">
                <p className="text-xs font-semibold text-slate-700">No route to draw.</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  The tracker reported this drive but recorded no usable position for any leg of it.
                </p>
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute bottom-3 left-3 z-[650] rounded-xl border border-slate-200 bg-white/92 px-2.5 py-2 shadow-sm backdrop-blur-sm">
              <ul className="space-y-0.5">
                {([
                  [STYLE.moving.line, 'Driving', false],
                  [STYLE.offline.line, 'Tracker offline — road unknown', true],
                  [STYLE.stopped.dot, 'Stopped', false],
                  [STYLE.idling.dot, 'Idling', false],
                ] as const).map(([colour, label, dashed]) => (
                  <li key={label} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span
                      className="inline-block h-0.5 w-4 shrink-0"
                      style={dashed
                        ? { backgroundImage: `repeating-linear-gradient(to right, ${colour} 0 4px, transparent 4px 8px)` }
                        : { backgroundColor: colour }}
                    />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* When it was where, in order. */}
        <div
          className={
            fullscreen
              ? 'order-2 flex max-h-[38%] min-h-0 flex-col border-t border-slate-100 lg:order-1 lg:max-h-none lg:w-80 lg:shrink-0 lg:border-r lg:border-t-0'
              : 'order-2 flex shrink-0 flex-col border-t border-slate-100 lg:order-1 lg:w-80 lg:border-r lg:border-t-0'
          }
        >
          <div className={fullscreen ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-[260px] overflow-y-auto lg:max-h-[380px]'}>
            <ol className="divide-y divide-slate-50">
              {segments.map((segment, index) => {
                const kind = kindOf(segment)
                const style = STYLE[kind]
                const unrecorded = kind === 'offline' && segmentPoints(segment).kind === 'straight'
                const plottableRow = segmentPoints(segment).kind !== 'none'
                const isSelected = index === selected
                const where = segment.startAddress || segment.endAddress
                const showDay = index === 0 || dayOf(segment.startTsMs) !== dayOf(segments[index - 1]?.startTsMs ?? null)
                return (
                  <li key={index}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) rowRefs.current.set(index, el)
                        else rowRefs.current.delete(index)
                      }}
                      onClick={() => setSelected(isSelected ? null : index)}
                      aria-pressed={isSelected}
                      disabled={!plottableRow}
                      className={
                        'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ' +
                        (isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50 disabled:hover:bg-transparent')
                      }
                    >
                      <span className="w-11 shrink-0 pt-0.5 text-right">
                        <span className="block text-[11px] font-bold tabular-nums text-slate-700">
                          {clockOf(segment.startTsMs)}
                        </span>
                        {showDay ? (
                          <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                            {dayOf(segment.startTsMs)}
                          </span>
                        ) : null}
                      </span>
                      <span
                        aria-hidden
                        className="mt-1 h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
                        style={{ backgroundColor: style.dot }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="text-xs font-bold text-slate-900">{style.label}</span>
                          <span className="text-[11px] text-slate-400">{durationOf(segment)}</span>
                        </span>
                        {kind === 'moving' && typeof segment.distanceKm === 'number' ? (
                          <span className="block text-[11px] text-slate-500">
                            {segment.distanceKm.toFixed(2)} km
                            {segment.averageSpeedKph ? ` · avg ${Math.round(segment.averageSpeedKph)} km/h` : ''}
                          </span>
                        ) : null}
                        {where ? (
                          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{where}</span>
                        ) : kind === 'stopped' || kind === 'idling' ? (
                          /* Stops carry no address at all from this provider — say so rather than
                             leave a blank that reads as "nowhere". */
                          <span className="mt-0.5 block text-[11px] italic text-slate-400">Street not recorded</span>
                        ) : null}
                        {unrecorded ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#92400e' }}>
                            <TriangleAlert className="h-3 w-3" /> Road taken not recorded
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </div>

      {/*
        * The one sentence that keeps this screen honest. A drawn line is the provider's trace, and a
        * dashed one is two known points with a guess between them.
        */}
      <p className="shrink-0 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
        Solid lines are the route the tracker recorded. A dashed line means the tracker was offline for
        that stretch — the two ends are known, the road between them is not.
      </p>
    </section>
  )
}
