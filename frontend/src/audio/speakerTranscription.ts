import { ApiError } from '../api/client'
import type { Segment } from '../api/types'
import { sharedWebSpeech, type WebSpeechTranscriber } from './webSpeech'

export type SpeakerStatus = 'idle' | 'starting' | 'live' | 'stopping' | 'stopped' | 'error'

export interface SpeakerSnapshot {
  status: SpeakerStatus
  talkId: string | null
  recordingId: string | null
  /** Utterances recognized but not yet confirmed by the server. */
  pending: number
  sent: number
  error: string | null
}

export interface SpeakerApi {
  startRecording(talkId: string): Promise<{ recording_id: string }>
  textSegment(recordingId: string, seg: { sequence: number; start_ms: number; end_ms: number; text: string }): Promise<unknown>
  stopRecording(recordingId: string): Promise<unknown>
}

export interface SpeakerDeps {
  api: SpeakerApi
  transcriber?: WebSpeechTranscriber
  sleep?: (ms: number) => Promise<void>
}

type Item = { start_ms: number; end_ms: number; text: string }

const IDLE: SpeakerSnapshot = { status: 'idle', talkId: null, recordingId: null, pending: 0, sent: 0, error: null }

/**
 * Speaker-side live transcription: browser speech recognition → backend text
 * segments → the talk's authoritative transcript every attendee reads.
 * Sequences are assigned at send time, so a dropped utterance never leaves a
 * gap that would stall attendees' polling.
 */
export class SpeakerTranscription {
  private readonly api: SpeakerApi
  private readonly transcriber: WebSpeechTranscriber
  private readonly sleep: (ms: number) => Promise<void>
  private snap: SpeakerSnapshot = IDLE
  private listeners = new Set<() => void>()
  private queue: Item[] = []
  private nextSeq = 0
  private pumping: Promise<void> | null = null
  private offSegment: (() => void) | null = null
  private wakeLock: { release(): Promise<void> } | null = null

  constructor(deps: SpeakerDeps) {
    this.api = deps.api
    this.transcriber = deps.transcriber ?? sharedWebSpeech()
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get supported() {
    return this.transcriber.supported
  }
  get speech() {
    return this.transcriber
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
  getSnapshot = () => this.snap

  get isActive() {
    return ['starting', 'live', 'stopping'].includes(this.snap.status)
  }

  async start(talkId: string, lang = 'sr-RS'): Promise<void> {
    if (this.isActive) return
    if (!this.transcriber.supported) {
      this.set({ ...IDLE, status: 'error', talkId, error: 'Ovaj pregledač ne podržava prepoznavanje govora. Koristite Chrome ili Edge.' })
      return
    }
    this.set({ ...IDLE, status: 'starting', talkId })
    let recordingId: string
    try {
      recordingId = (await this.api.startRecording(talkId)).recording_id
    } catch (e) {
      this.set({ status: 'error', error: message(e, 'Transkripciju nije moguće pokrenuti.') })
      return
    }
    this.queue = []
    this.nextSeq = 0
    this.offSegment?.()
    this.transcriber.stop()
    this.transcriber.reset()
    this.offSegment = this.transcriber.onSegment((s) => this.enqueue(s))
    this.transcriber.setLang(lang)
    this.transcriber.start(lang)
    if (this.transcriber.getSnapshot().status === 'error') {
      this.set({ status: 'error', recordingId, error: this.transcriber.getSnapshot().error })
      return
    }
    this.set({ status: 'live', recordingId })
    void this.acquireWakeLock()
  }

  async stop(): Promise<void> {
    const rid = this.snap.recordingId
    if (!rid || !this.isActive) return
    this.set({ status: 'stopping' })
    this.transcriber.stop() // flushes the utterance in progress into the queue
    this.offSegment?.()
    this.offSegment = null
    if (this.pumping) await Promise.race([this.pumping, this.sleep(10_000)])
    void this.wakeLock?.release().catch(() => undefined)
    this.wakeLock = null
    try {
      await this.api.stopRecording(rid)
      this.set({ status: 'stopped' })
    } catch (e) {
      this.set({ status: 'stopped', error: message(e, 'Server nije potvrdio zaustavljanje.') })
    }
  }

  private enqueue(s: Segment) {
    if (!this.snap.recordingId || !s.text.trim()) return
    this.queue.push({ start_ms: s.start_ms, end_ms: s.end_ms, text: s.text })
    this.set({ pending: this.queue.length })
    this.pumping ??= this.pump().finally(() => {
      this.pumping = null
    })
  }

  private async pump() {
    let delay = 500
    while (this.queue.length && this.snap.recordingId) {
      const item = this.queue[0]
      try {
        await this.api.textSegment(this.snap.recordingId, { sequence: this.nextSeq, ...item })
        this.nextSeq++
        this.queue.shift()
        delay = 500
        this.set({ pending: this.queue.length, sent: this.snap.sent + 1, error: null })
      } catch (e) {
        if (e instanceof ApiError && !e.retryable) {
          // Rejected for good (e.g. not this talk's speaker): drop it, keep the sequence for the next one.
          this.queue.shift()
          this.set({ pending: this.queue.length, error: message(e, 'Server je odbio deo transkripta.') })
          continue
        }
        this.set({ error: 'Nema veze sa serverom — transkript čeka i biće poslat.' })
        await this.sleep(delay)
        delay = Math.min(delay * 2, 8000)
      }
    }
  }

  private async acquireWakeLock() {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
      if (wl) this.wakeLock = await wl.request('screen')
    } catch {
      // best effort: a sleeping screen stops recognition on most phones
    }
  }

  private set(patch: Partial<SpeakerSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}
