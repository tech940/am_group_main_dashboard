/**
 * AI Call Review — PILOT (phase 1 gate). Runs real AM Hyundai recordings through Groq and writes a review sheet.
 * WRITES NOTHING TO ANY DATABASE: reads the CRE project and our exclusions, calls Groq, writes files locally.
 *
 *   npm run call-ai:pilot -- [--n=40] [--days=7] [--variants=whisper-large-v3:translate,whisper-large-v3:hi]
 *                            [--no-audio] [--concurrency=2]
 *   npm run call-ai:pilot -- --resume=.call-ai-pilot/<run>      continue a stopped run (same calls, finished ones kept)
 *   npm run call-ai:pilot -- --score=.call-ai-pilot/<run>/review.xlsx
 *
 * Progress is saved after EVERY call (rows.jsonl + a rebuilt review.xlsx), so stopping the run loses nothing.
 * When Groq says a daily limit is hit (free tier), the run stops cleanly and prints the resume command.
 *
 * Output (gitignored — it holds real customer calls): .call-ai-pilot/<timestamp>/
 *   review.xlsx   one row per call: each transcript variant side by side, the AI verdict, and empty columns for
 *                 the reviewer (verdict right? intent right? mood right? which transcript reads best?)
 *   audio/NN.*    the recordings, so the reviewer can listen while marking (skip with --no-audio)
 *   summary.json  timings, cost, languages, privacy checks — no customer data
 *
 * The verdict is written from the FIRST variant's transcript (the production setting); the other variants are
 * shown so the reviewer can say which one reads best. Gate: intent ≥ 85%, mood ≥ 80%, 0 invented quotes.
 */
import 'dotenv/config'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { analyseTranscript } from '../lib/call-ai/analyse'
import { llmCostUsd, sttCostUsd, callAiConfig } from '../lib/call-ai/config'
import { supabaseCreSource, type CreRecording } from '../lib/call-ai/cre-source'
import { buildQueueRows } from '../lib/call-ai/discovery'
import { AiProviderError } from '../lib/call-ai/errors'
import type { ChatMessage } from '../lib/call-ai/groq'
import { transcribe } from '../lib/call-ai/groq'
import { transcribeElevenLabs } from '../lib/call-ai/elevenlabs'
import { providerChat } from '../lib/call-ai/providers'
import { sttPrompt } from '../lib/call-ai/prompt'
import { classifyScope } from '../lib/call-ai/scope'
import { contentTypeFor, filterSegments, sniffAudio } from '../lib/call-ai/stt-filter'
import { INTENT_LABELS, MOOD_LABELS, VERDICT_LABELS, type Segment } from '../lib/call-ai/types'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=')
  return [k, v.length ? v.join('=') : 'true']
}))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Groq's daily (not per-minute) limit: waiting would take hours, so the run stops and can be resumed. */
class DailyLimitError extends Error {}

/** Groq on a lower tier answers 429 generously; the pilot just waits and tries again. */
async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      // A retry-after of minutes means a DAILY cap was hit (free tier): give up on this call rather than stall.
      const tooLong = error instanceof AiProviderError && error.kind === 'rate_limited' && (error.retryAfterSeconds ?? 0) > 20 * 60
      if (tooLong) throw new DailyLimitError(`${label}: the provider asks to wait ${Math.round((error as AiProviderError).retryAfterSeconds! / 60)} min (${(error as AiProviderError).message.slice(0, 120)})`)
      if (error instanceof AiProviderError && (error.kind === 'rate_limited' || error.kind === 'transient') && attempt < 8 && !tooLong) {
        const wait = error.kind === 'rate_limited' ? (error.retryAfterSeconds ?? 20) * 1000 + 500 : 3000 * attempt
        console.log(`    … ${label}: ${error.kind === 'rate_limited' ? 'rate limited' : error.message.slice(0, 60)}, waiting ${Math.round(wait / 1000)} s`)
        await sleep(wait)
        continue
      }
      throw error
    }
  }
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function transcriptText(segments: Segment[]): string {
  return segments.map((s) => `${mmss(s.s)}  ${s.p ? `${s.p}: ` : ''}${s.t}${s.f ? '  (?)' : ''}`).join('\n')
}

function bucket(seconds: number): string {
  if (seconds < 30) return 'short'
  if (seconds < 90) return 'medium'
  if (seconds < 300) return 'long'
  return 'very long'
}

/** Round-robin across (desk, direction, length) so a small sample still covers every kind of call. */
function stratify(recs: Array<{ rec: CreRecording; team: string }>, n: number): Array<{ rec: CreRecording; team: string }> {
  const groups = new Map<string, Array<{ rec: CreRecording; team: string }>>()
  for (const item of recs) {
    const key = `${item.team}|${item.rec.call_type}|${bucket(Number(item.rec.duration_seconds) || 0)}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  // Deterministic: by id within each group.
  for (const list of groups.values()) list.sort((a, b) => a.rec.id.localeCompare(b.rec.id))
  const lists = [...groups.values()]
  const picked: Array<{ rec: CreRecording; team: string }> = []
  for (let i = 0; picked.length < n && lists.some((l) => l.length > i); i += 1) {
    for (const list of lists) if (list[i] && picked.length < n) picked.push(list[i])
  }
  return picked
}

async function score(file: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.getWorksheet('Review')
  if (!sheet) throw new Error('No "Review" sheet in that file')
  const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? '').trim())
  const col = (name: string) => header.indexOf(name)
  const yes = (v: unknown) => /^(y|yes|✓|1|true)$/i.test(String(v ?? '').trim())
  const no = (v: unknown) => /^(n|no|✗|0|false)$/i.test(String(v ?? '').trim())
  const tally: Record<string, { yes: number; no: number }> = {}
  const best: Record<string, number> = {}
  sheet.eachRow((row, index) => {
    if (index === 1) return
    for (const name of ['Verdict right? (Y/N)', 'Intent right? (Y/N)', 'Mood right? (Y/N)', '"Customer wanted" right? (Y/N)']) {
      const value = row.getCell(col(name)).value
      tally[name] = tally[name] ?? { yes: 0, no: 0 }
      if (yes(value)) tally[name].yes += 1
      else if (no(value)) tally[name].no += 1
    }
    const pick = String(row.getCell(col('Best transcript (A/B/C)')).value ?? '').trim().toUpperCase()
    if (pick) best[pick] = (best[pick] ?? 0) + 1
  })
  console.log('\nPilot score')
  for (const [name, t] of Object.entries(tally)) {
    const rated = t.yes + t.no
    console.log(`  ${name.padEnd(34)} ${rated ? `${Math.round((t.yes / rated) * 100)}%` : '—'}  (${t.yes} of ${rated} rated)`)
  }
  console.log('  Best transcript votes:', JSON.stringify(best))
  const intent = tally['Intent right? (Y/N)']
  const mood = tally['Mood right? (Y/N)']
  const pass = intent && mood && intent.yes / Math.max(1, intent.yes + intent.no) >= 0.85 && mood.yes / Math.max(1, mood.yes + mood.no) >= 0.8
  console.log(pass ? '\n  GATE PASSED (intent ≥ 85%, mood ≥ 80%)' : '\n  Gate not met yet (intent ≥ 85%, mood ≥ 80%)')
}

async function main() {
  if (args.score) return score(String(args.score))
  if (!process.env.CALL_GROQ_API_KEY) throw new Error('CALL_GROQ_API_KEY is not set')

  const n = Math.max(1, Math.min(200, Number(args.n) || 40))
  const days = Math.max(1, Math.min(30, Number(args.days) || 7))
  const concurrency = Math.max(1, Math.min(4, Number(args.concurrency) || 2))
  // Default = the production transcriber (ElevenLabs Scribe, Hindi). 'whisper-large-v3:translate' tries Groq.
  const variants = String(args.variants || `${callAiConfig().sttModel}:${callAiConfig().sttLanguage ?? 'auto'}`)
    .split(',').map((v) => { const [model, lang] = v.split(':'); return { model: model.trim(), language: !lang || lang === 'auto' ? null : lang.trim(), label: v.trim() } })
  const letters = ['A', 'B', 'C', 'D']
  const cfg = callAiConfig()
  const saveAudio = args['no-audio'] !== 'true'

  const resume = typeof args.resume === 'string' && args.resume !== 'true' ? String(args.resume).replace(/[\\/]+$/, '') : null
  const outDir = resume ?? join('.call-ai-pilot', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(join(outDir, 'audio'), { recursive: true })
  const sampleFile = join(outDir, 'sample.json')
  const rowsFile = join(outDir, 'rows.jsonl')

  const source = supabaseCreSource()
  let sample: Array<{ rec: CreRecording; team: string }>
  let runVariants = variants
  if (resume) {
    if (!existsSync(sampleFile)) throw new Error(`${sampleFile} not found — only runs started with this version can be resumed`)
    const saved = JSON.parse(readFileSync(sampleFile, 'utf8')) as { variants: typeof variants; sample: Array<{ id: string; team: string }> }
    runVariants = saved.variants
    const recs = new Map((await source.getByIds(saved.sample.map((s) => s.id))).map((r) => [r.id, r]))
    sample = saved.sample.filter((s) => recs.has(s.id)).map((s) => ({ rec: recs.get(s.id)!, team: s.team }))
    console.log(`Resuming ${outDir}: ${sample.length} calls, variants ${runVariants.map((v) => v.label).join(' | ')}`)
  } else {
    console.log(`Pilot: ${n} AM Hyundai calls from the last ${days} days, variants ${variants.map((v) => v.label).join(' | ')}`)
    const dir = await source.loadDirectory()
    const now = Date.now()
    let recs: CreRecording[] = []
    let afterId: string | null = null
    for (let page = 0; page < 30; page += 1) {
      const batch = await source.listRecorded(new Date(now - days * 86400_000).toISOString(), new Date(now).toISOString(), afterId, 1000)
      recs = recs.concat(batch)
      if (batch.length < 1000) break
      afterId = batch[batch.length - 1].id
    }
    // Same rules as production: scope, then the pre-skips (too short, not connected, staff numbers …).
    const queued = await buildQueueRows(recs, dir, cfg.scope, 0)
    const eligible = new Set(queued.filter((r) => r.status === 'queued').map((r) => r.cre_recording_id))
    const candidates = recs
      .filter((r) => eligible.has(r.id))
      .map((rec) => {
        const c = classifyScope(rec, dir, cfg.scope)
        return { rec, team: c.inScope ? c.team : '?' }
      })
    sample = stratify(candidates, n)
    writeFileSync(sampleFile, JSON.stringify({ createdAt: new Date().toISOString(), days, variants, sample: sample.map((s) => ({ id: s.rec.id, team: s.team })) }, null, 2))
    console.log(`${recs.length} recordings scanned → ${queued.length} AM Hyundai → ${candidates.length} worth transcribing → ${sample.length} sampled`)
  }
  console.log(`Output: ${outDir} (gitignored)`)

  // Rows already finished (a resumed run) — keyed by their number.
  type Row = Record<string, unknown>
  const done = new Map<string, Row>()
  if (existsSync(rowsFile)) {
    for (const line of readFileSync(rowsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { const row = JSON.parse(line) as Row; done.set(String(row['#']), row) } catch { /* a half-written last line */ }
    }
    if (done.size) console.log(`${done.size} call(s) already done — skipping them`)
  }

  const reviewerColumns = ['Verdict right? (Y/N)', 'Correct verdict', 'Intent right? (Y/N)', 'Mood right? (Y/N)', '"Customer wanted" right? (Y/N)', 'Best transcript (A/B/C)', 'Reviewer notes']
  const writeSheet = async () => {
    const all = [...done.values()].sort((a, b) => String(a['#']).localeCompare(String(b['#'])))
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Review', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
    const keys = [...new Set(all.flatMap((r) => Object.keys(r)))].filter((k) => !k.startsWith('_'))
    const columns = [...keys.slice(0, 6), ...reviewerColumns, ...keys.slice(6)]
    sheet.columns = columns.map((key) => ({ header: key, key, width: /Transcript|Summary|Evidence|Promises/.test(key) ? 60 : /Headline|wanted|notes|verdict/i.test(key) ? 34 : 14 }))
    for (const r of all) sheet.addRow(Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))))
    sheet.getRow(1).font = { bold: true }
    sheet.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true } })
    for (const name of reviewerColumns) sheet.getColumn(name).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }
    const legend = workbook.addWorksheet('How to review')
    legend.addRows([
      ['Listen to audio/NN.* for row NN, then fill the yellow columns.'],
      ['Verdict right? — is the chip (Complaint / Unhappy / Hot lead / Follow-up / Service / Enquiry / Unclear …) what you would have said?'],
      ['Intent right? / Mood right? — the purpose of the call, and how the customer sounded at the end.'],
      ['Best transcript — which of A / B is easiest to read and closest to what was said.'],
      ['Then run: npm run call-ai:pilot -- --score=<this file>'],
    ])
    await workbook.xlsx.writeFile(join(outDir, 'review.xlsx'))
  }

  const todo = sample.map((item, index) => ({ ...item, number: String(index + 1).padStart(2, '0') })).filter((item) => !done.has(item.number))
  const signed = todo.length ? await source.signPaths(todo.map((s) => s.rec.storage_path!).filter(Boolean), 3600) : new Map<string, string>()
  const chat = providerChat()
  let stopped: string | null = null
  let saving = Promise.resolve()

  let cursor = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < todo.length && !stopped) {
      const { rec, team, number } = todo[cursor++]
      const started = Date.now()
      const row: Row = {
        '#': number,
        'Recording id': rec.id.slice(0, 8),
        'Call time (IST)': new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(rec.recorded_at!)),
        Desk: team,
        Direction: rec.call_type,
        'Length (s)': rec.duration_seconds,
      }
      let cost = 0
      try {
        const url = signed.get(rec.storage_path!)
        if (!url) throw new Error('could not sign the audio URL')
        const audio = await source.download(url, cfg.maxAudioBytes, 30_000)
        const kind = sniffAudio(audio)
        if (!kind) throw new Error('not an audio file')
        if (saveAudio) writeFileSync(join(outDir, 'audio', `${number}.${kind}`), audio)

        let primary: Segment[] = []
        let primaryLanguage: string | null = null
        for (const [i, variant] of runVariants.entries()) {
          const translate = variant.language === 'translate'
          const scribe = variant.model.startsWith('scribe')
          const whisper = await withRetry(`#${number} ${variant.label}`, () => scribe
            ? transcribeElevenLabs({ audio, fileName: `${rec.id}.${kind}`, contentType: contentTypeFor(kind), model: variant.model, language: variant.language, timeoutMs: 180_000 })
            : transcribe({
              audio, fileName: `${rec.id}.${kind}`, contentType: contentTypeFor(kind), model: variant.model, language: translate ? null : variant.language,
              task: translate ? 'translate' : 'transcribe', prompt: sttPrompt(), timeoutMs: 120_000,
            }))
          cost += sttCostUsd(variant.model, whisper.duration)
          const filtered = filterSegments(whisper.segments, { prompt: scribe ? null : sttPrompt() })
          row[`Transcript ${letters[i]} (${variant.label})`] = filtered.noConversation ? '(no conversation)' : transcriptText(filtered.segments)
          row[`Language ${letters[i]}`] = translate ? 'English (translated)' : whisper.language
          if (i === 0) { primary = filtered.segments; primaryLanguage = translate ? 'translated-en' : whisper.language; row['No conversation'] = filtered.noConversation ? 'yes' : '' }
        }

        if (primary.length && row['No conversation'] !== 'yes') {
          let rawQuotes = 0
          const outcome = await withRetry(`#${number} verdict`, () => analyseTranscript({
            segments: primary,
            meta: { team, callType: rec.call_type, recordedAt: rec.recorded_at, durationSeconds: rec.duration_seconds, sttLanguage: primaryLanguage },
            model: cfg.llmModel,
            timeoutMs: 90_000,
            chat: async (input) => {
              const body = JSON.stringify(input.messages as ChatMessage[])
              const digits = String(rec.phone || '').replace(/\D/g, '').slice(-10)
              if ((digits && body.includes(digits)) || (rec.contact_name && body.includes(rec.contact_name))) row._leak = true
              const reply = await chat(input)
              try { rawQuotes = (JSON.parse(reply.content)?.evidence ?? []).length } catch { /* repaired later */ }
              return reply
            },
          }))
          cost += llmCostUsd(outcome.model, outcome.tokensIn, outcome.tokensOut, outcome.cacheReadTokens, outcome.cacheWriteTokens)
          const a = outcome.analysis
          row._tokensIn = outcome.tokensIn
          row._tokensOut = outcome.tokensOut
          // sanitizeAnalysis drops any quote that is not in the segment it cites; count what it caught.
          row._invented = Math.max(0, rawQuotes - a.evidence.length)
          row['AI verdict'] = VERDICT_LABELS[outcome.verdict]
          row['Headline'] = a.headline_en
          row['Customer wanted'] = a.customer_wanted
          row['Summary'] = a.summary_en
          row['Intent'] = INTENT_LABELS[a.intent]
          row['Mood at end'] = MOOD_LABELS[a.mood_end]
          row['Satisfaction 1-5'] = a.satisfaction ?? ''
          row['Lead'] = a.lead.temperature
          row['Complaint'] = a.complaint.is_complaint ? `${a.complaint.about ?? ''} (${a.complaint.severity ?? ''})` : ''
          row['Promises'] = a.commitments.map((c) => `${c.by}: ${c.what}${c.due ? ` by ${c.due}` : ''}`).join('\n')
          row['Next action'] = a.next_action.needed ? `${a.next_action.owner ?? ''}: ${a.next_action.what ?? ''}${a.next_action.due ? ` by ${a.next_action.due}` : ''}` : ''
          row['Red flags'] = a.red_flags.join(', ')
          row['Staff handling 1-5'] = a.staff_handling.score ?? ''
          row['Evidence'] = a.evidence.map((e) => `[${e.segment}] ${e.speaker_guess}: "${e.quote}" = ${e.meaning_en}`).join('\n')
          row['Confidence'] = a.confidence
          row['Needs human review'] = a.needs_human_review ? 'yes' : ''
          row['Conversation'] = a.conversation
        } else {
          row['AI verdict'] = 'Skipped — no conversation'
        }
      } catch (error) {
        if (error instanceof DailyLimitError) {
          // Not recorded: a resumed run retries this call from scratch.
          stopped = error.message
          break
        }
        row['AI verdict'] = `ERROR: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`
      }
      row._ms = Date.now() - started
      row._cost = cost
      row['Seconds to review'] = Math.round(Number(row._ms) / 100) / 10
      done.set(number, row)
      appendFileSync(rowsFile, `${JSON.stringify(row)}\n`)
      saving = saving.then(writeSheet).catch((e) => console.error('could not write the sheet:', e instanceof Error ? e.message : e))
      console.log(`  #${number} ${String(row['AI verdict']).padEnd(24)} ${String(row['Headline'] ?? '').slice(0, 70)}`)
    }
  }))
  await saving
  await writeSheet()

  const all = [...done.values()]
  const timings = all.map((r) => Number(r._ms) || 0).sort((a, b) => a - b)
  const summary = {
    calls: all.length,
    ofSample: sample.length,
    complete: all.length === sample.length,
    variants: runVariants.map((v) => v.label),
    errors: all.filter((r) => String(r['AI verdict'] ?? '').startsWith('ERROR')).length,
    noConversation: all.filter((r) => r['No conversation'] === 'yes').length,
    verdicts: all.reduce<Record<string, number>>((acc, r) => { const v = String(r['AI verdict'] ?? ''); acc[v] = (acc[v] ?? 0) + 1; return acc }, {}),
    languages: all.reduce<Record<string, number>>((acc, r) => { const l = String(r['Language A'] ?? '?'); acc[l] = (acc[l] ?? 0) + 1; return acc }, {}),
    secondsPerCall: { p50: (timings[Math.floor(timings.length / 2)] ?? 0) / 1000, p95: (timings[Math.floor(timings.length * 0.95)] ?? 0) / 1000 },
    tokens: { in: all.reduce((s, r) => s + (Number(r._tokensIn) || 0), 0), out: all.reduce((s, r) => s + (Number(r._tokensOut) || 0), 0) },
    costUsd: Math.round(all.reduce((s, r) => s + (Number(r._cost) || 0), 0) * 10000) / 10000,
    privacyLeaks: all.filter((r) => r._leak).length,
    inventedQuotesCaughtAndDropped: all.reduce((s, r) => s + (Number(r._invented) || 0), 0),
    inventedQuotesStored: 0,
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('\nSummary', JSON.stringify(summary, null, 2))
  if (stopped) {
    console.log(`\nSTOPPED at Groq's daily limit — ${stopped}`)
    console.log(`Nothing is lost. Resume later with:  npm run call-ai:pilot -- --resume=${outDir.replace(/\\/g, '/')}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
