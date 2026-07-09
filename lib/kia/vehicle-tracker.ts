import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaVehicleTracker } from '@/lib/db/schema'
import { supabaseAdmin } from '@/lib/supabase/admin'

const STORAGE_BUCKET = 'purchase-orders'
const STORAGE_FOLDER = 'kia-vehicle-tracker'

export type VehicleTrackerEntry = typeof kiaVehicleTracker.$inferSelect

export type VehicleVerification = { ok: boolean; reason: string }

const NOT_A_VEHICLE = 'No vehicle detected. Please capture a clear photo of the vehicle.'
const NOT_FRONT = 'Only the FRONT of the vehicle is accepted. Capture the front — grille, headlights and number plate facing the camera.'

/**
 * Use the app's Groq vision model (same one that powers the cost-sheet check) to
 * decide whether an image clearly shows the FRONT of a motor vehicle. Returns
 * { ok:false } when it is not a vehicle, not the front, or the call is unavailable —
 * the caller surfaces the reason so the user re-shoots the photo.
 */
export async function verifyImageHasVehicle(file: File): Promise<VehicleVerification> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return { ok: false, reason: 'AI verification is not configured (missing GROQ_API_KEY).' }

  const buffer = await file.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const mimeType = file.type || 'image/jpeg'

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Look at this photo of a motor vehicle (car, SUV, van, truck, bus or motorcycle). A small date/time stamp may be overlaid — ignore it. Decide two things: (1) is a motor vehicle clearly visible, and (2) is it photographed from the FRONT (you can see the grille, both headlights, and/or the front number plate facing the camera — NOT the side profile, rear, or interior). Respond with ONLY strict JSON on one line: {"vehicle": true|false, "front": true|false, "reason": "<max 8 words>"}.',
              },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: 120,
        temperature: 0,
      }),
    })

    if (!response.ok) {
      console.error('Groq vehicle-verify error:', await response.text())
      return { ok: false, reason: 'Could not verify the photo. Please try again.' }
    }

    const data = await response.json()
    const raw = String(data.choices?.[0]?.message?.content || '')
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { vehicle?: unknown; front?: unknown; reason?: unknown }
        const isVehicle = parsed.vehicle === true || String(parsed.vehicle).toLowerCase() === 'true'
        const isFront = parsed.front === true || String(parsed.front).toLowerCase() === 'true'
        if (!isVehicle) return { ok: false, reason: NOT_A_VEHICLE }
        if (!isFront) return { ok: false, reason: NOT_FRONT }
        return { ok: true, reason: String(parsed.reason || 'Front of vehicle detected.') }
      } catch {
        // fall through to text heuristic
      }
    }
    // Heuristic fallback if JSON parsing failed: require a vehicle word AND a front cue.
    const hasVehicle = /\b(vehicle|car|suv|van|truck|bus|motorcycle|bike)\b/i.test(raw)
    const hasFront = /\bfront\b/i.test(raw) && !/\bnot\s+(the\s+)?front\b/i.test(raw)
    if (!hasVehicle) return { ok: false, reason: NOT_A_VEHICLE }
    if (!hasFront) return { ok: false, reason: NOT_FRONT }
    return { ok: true, reason: 'Front of vehicle detected.' }
  } catch (error) {
    console.error('Groq vehicle-verify failed:', error)
    return { ok: false, reason: 'Could not verify the photo. Please try again.' }
  }
}

export async function uploadTrackerPhoto(file: File, kind: 'out' | 'in'): Promise<{ url: string; path: string }> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const mimeType = file.type || 'image/jpeg'
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const filename = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = `${STORAGE_FOLDER}/${filename}`

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`Failed to store photo: ${error.message}`)

  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

export type ListVehicleTrackerInput = {
  dealerCode?: string | null
  date?: string | null
  status?: 'out' | 'returned' | 'all' | null
}

export async function listVehicleTrackerEntries(input: ListVehicleTrackerInput = {}): Promise<VehicleTrackerEntry[]> {
  const conditions = []
  if (input.dealerCode) conditions.push(eq(kiaVehicleTracker.dealerCode, input.dealerCode))
  if (input.date) conditions.push(eq(kiaVehicleTracker.entryDate, input.date))
  if (input.status && input.status !== 'all') conditions.push(eq(kiaVehicleTracker.status, input.status))
  const where = conditions.length ? and(...conditions) : undefined

  return db
    .select()
    .from(kiaVehicleTracker)
    .where(where)
    .orderBy(desc(kiaVehicleTracker.vehicleOutAt))
    .limit(500)
}

export type CreateVehicleTrackerInput = {
  name: string
  entryDate: string
  vehicleOutAt: Date
  vehicleInAt: Date | null
  outPhotoUrl: string
  outPhotoPath: string
  dealerCode: string | null
  notes: string | null
  createdBy: string | null
}

function minutesBetween(out: Date, back: Date): number {
  return Math.max(0, Math.round((back.getTime() - out.getTime()) / 60000))
}

export async function createVehicleTrackerEntry(input: CreateVehicleTrackerInput): Promise<VehicleTrackerEntry> {
  const returned = input.vehicleInAt != null
  const [row] = await db
    .insert(kiaVehicleTracker)
    .values({
      name: input.name,
      entryDate: input.entryDate,
      vehicleOutAt: input.vehicleOutAt,
      vehicleInAt: input.vehicleInAt,
      status: returned ? 'returned' : 'out',
      durationMinutes: returned ? minutesBetween(input.vehicleOutAt, input.vehicleInAt as Date) : null,
      outPhotoUrl: input.outPhotoUrl,
      outPhotoPath: input.outPhotoPath,
      dealerCode: input.dealerCode,
      notes: input.notes,
      createdBy: input.createdBy,
    })
    .returning()
  return row
}

export type CheckInVehicleTrackerInput = {
  id: string
  vehicleInAt: Date
  inPhotoUrl: string | null
  inPhotoPath: string | null
  updatedBy: string | null
}

export async function checkInVehicleTrackerEntry(input: CheckInVehicleTrackerInput): Promise<VehicleTrackerEntry | null> {
  const [existing] = await db.select().from(kiaVehicleTracker).where(eq(kiaVehicleTracker.id, input.id)).limit(1)
  if (!existing) return null

  const [row] = await db
    .update(kiaVehicleTracker)
    .set({
      vehicleInAt: input.vehicleInAt,
      status: 'returned',
      durationMinutes: minutesBetween(new Date(existing.vehicleOutAt), input.vehicleInAt),
      inPhotoUrl: input.inPhotoUrl,
      inPhotoPath: input.inPhotoPath,
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .where(eq(kiaVehicleTracker.id, input.id))
    .returning()
  return row
}
