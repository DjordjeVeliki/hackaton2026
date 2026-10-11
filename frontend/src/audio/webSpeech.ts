import type { Segment } from '../api/types'

/*
 * Browser speech recognition (Web Speech API) on the speaker's device.
 *
 * Recognition is performed by the browser vendor (Chrome/Edge use their own
 * speech service), not by Gemma. Finalized utterances are published by
 * SpeakerTranscription to the backend, where they become the talk's
 * authoritative transcript that attendees read and Gemma summarizes/judges.
 */

// Minimal typings: SpeechRecognition is not part of TypeScript's lib.dom.
interface SpeechAlternative {
  transcript: string
}
interface SpeechResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechAlternative
}
export interface SpeechResultEvent {
  readonly resultIndex: number
  readonly results: { readonly length: number; [index: number]: SpeechResult }
}
export interface SpeechErrorEvent {
  readonly error: string
}
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type WebSpeechStatus = 'unsupported' | 'idle' | 'listening' | 'stopped' | 'error'

export interface WebSpeechSnapshot {
  status: WebSpeechStatus
  lang: string
  segments: Segment[]
  /** Not yet final text of the utterance currently being spoken. */
  interim: string
  error: string | null
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone or speech recognition access was denied in the browser.',
  'service-not-allowed': 'The browser does not allow speech recognition on this page.',
  'audio-capture': 'Microphone not available.',
  network: 'Speech recognition needs an internet connection (the browser’s service is unreachable).',
  'language-not-supported': 'The selected language is not supported for speech recognition in this browser.',
}
// Errors after which restarting would just fail again.
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

export interface WebSpeechDeps {
  ctor?: SpeechRecognitionCtor | null
  now?: () => number
  /** Quiet time after the last final result before the held utterance is published. */
  settleMs?: number
}

/** Words of an utterance: raw (as recognized) and normalized (for comparing revisions), aligned 1:1. */
function tokens(text: string): { raw: string[]; norm: string[] } {
  const raw: string[] = []
  const norm: string[] = []
  for (const tok of text.trim().split(/\s+/)) {
    const n = tok.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
    if (!n) continue
    raw.push(tok)
    norm.push(n)
  }
  return { raw, norm }
}

/**
 * If `next` is a later revision of `prev` (same start; the recognizer may still have changed the
 * last word or two, e.g. "...saying the" -> "...saying that you are..."), return how many words
 * they share; otherwise -1 (a new utterance).
 */
export function continuation(prev: string[], next: string[]): number {
  if (!prev.length || !next.length) return -1
  let common = 0
  while (common < prev.length && common < next.length && prev[common] === next[common]) common++
  const slack = prev.length >= 8 ? 2 : prev.length >= 4 ? 1 : 0
  return common > 0 && common >= prev.length - slack ? common : -1
}

/**
 * Continuous recognizer that outlives React components. Browsers end a
 * recognition session after silence or ~1 min, so it restarts itself while
 * the user still wants it running.
 */
export class WebSpeechTranscriber {
  private readonly ctor: SpeechRecognitionCtor | null
  private readonly now: () => number
  private rec: SpeechRecognitionLike | null = null
  private wanted = false
  private startedAt = 0
  private utteranceStart: number | null = null
  /** Finalized text held back until it stops growing (Android re-sends growing finals). */
  private held: { text: string; base: number; start: number; end: number } | null = null
  /** Raw interim (not final) text of the current recognition result. */
  private interimText = ''
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly settleMs: number
  /** Final text already handled at each result index of the current recognition session. */
  private seenFinals = new Map<number, string>()
  private lastPublished: string[] = []
  private seq = 0
  private restarts = 0
  private listeners = new Set<() => void>()
  private segmentListeners = new Set<(s: Segment) => void>()
  private snap: WebSpeechSnapshot

  constructor(deps: WebSpeechDeps = {}) {
    this.ctor = deps.ctor === undefined ? getSpeechRecognition() : deps.ctor
    this.now = deps.now ?? (() => performance.now())
    this.settleMs = deps.settleMs ?? 800
    this.snap = { status: this.ctor ? 'idle' : 'unsupported', lang: 'en-US', segments: [], interim: '', error: null }
  }

  get supported() {
    return this.ctor !== null
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
  getSnapshot = () => this.snap

  /** Called once for every finalized utterance (used to publish the speaker's transcript). */
  onSegment(cb: (s: Segment) => void) {
    this.segmentListeners.add(cb)
    return () => {
      this.segmentListeners.delete(cb)
    }
  }

  start(lang = this.snap.lang) {
    if (!this.ctor || this.wanted) return
    this.wanted = true
    this.restarts = 0
    if (this.snap.status !== 'stopped' || this.snap.segments.length === 0) {
      // New session; "Resume" after a stop keeps the existing text and timeline.
      this.seq = 0
      this.lastPublished = []
      this.startedAt = this.now()
      this.set({ segments: [], interim: '' })
    }
    this.set({ lang, error: null })
    this.open()
  }

  stop() {
    this.wanted = false
    const rec = this.rec
    this.rec = null
    if (rec) {
      rec.onend = null
      rec.stop()
    }
    this.commitInterim()
    this.flushHeld()
    this.set({ status: this.ctor ? 'stopped' : 'unsupported', interim: '' })
  }

  /** Change recognition language (only while not listening). */
  setLang(lang: string) {
    if (this.wanted || lang === this.snap.lang) return
    this.set({ lang })
  }

  /** Clear the transcript (only while not listening). */
  reset() {
    if (this.wanted) return
    this.seq = 0
    this.lastPublished = []
    this.held = null
    this.interimText = ''
    this.set({ status: this.ctor ? 'idle' : 'unsupported', segments: [], interim: '', error: null })
  }

  private open() {
    const rec = new this.ctor!()
    rec.lang = this.snap.lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e) => this.onResult(e)
    rec.onerror = (e) => this.onError(e)
    rec.onend = () => this.onEnd()
    this.rec = rec
    this.seenFinals.clear() // result indexes restart with every recognition session
    try {
      rec.start()
      this.set({ status: 'listening' })
    } catch (e) {
      this.wanted = false
      this.rec = null
      this.set({ status: 'error', error: e instanceof Error ? e.message : 'Could not start speech recognition.' })
    }
  }

  private onResult(e: SpeechResultEvent) {
    const t = this.now() - this.startedAt
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const text = (r[0]?.transcript ?? '').trim()
      if (!text) continue
      if (r.isFinal) {
        if (this.seenFinals.get(i) === text) continue // re-sent old final (seen on Android)
        this.seenFinals.set(i, text)
        if (this.utteranceStart === null) this.utteranceStart = t
        this.acceptFinal(text, t)
      } else {
        interim += (interim ? ' ' : '') + text
      }
    }
    if (interim && this.utteranceStart === null) this.utteranceStart = t
    this.interimText = interim
    this.refreshInterim()
  }

  /** What the speaker is saying that is not published yet: held tail + live interim, without repeats. */
  private refreshInterim() {
    const parts: string[] = []
    if (this.held) parts.push(tokens(this.held.text).raw.slice(this.held.base).join(' '))
    if (this.interimText) {
      const it = tokens(this.interimText)
      // Android interim text repeats the whole utterance; drop the part already held or published.
      const ref = this.held ? tokens(this.held.text).norm : this.lastPublished
      const c = continuation(ref, it.norm)
      parts.push(c >= 0 ? it.raw.slice(Math.max(c, ref.length)).join(' ') : this.interimText)
    }
    this.set({ interim: parts.filter(Boolean).join(' ') })
  }

  /**
   * Chrome on Android (continuous mode) reports every growing version of an utterance as a new
   * final result ("okay so", "okay so I'm", ...) and may revise its last words. Hold the newest
   * version while finals keep continuing it; publish only words that were not published before,
   * once a different utterance starts or the speaker pauses.
   */
  private acceptFinal(text: string, t: number) {
    const w = tokens(text).norm
    if (!w.length) return
    const ref = this.held ? tokens(this.held.text).norm : this.lastPublished
    const c = continuation(ref, w)
    // An exact re-send of (part of) the reference: same words, nothing new.
    const exactRepeat = c === w.length && w.length <= ref.length
    if (this.held) {
      if (c >= 0 && w.length >= ref.length) {
        this.held = { ...this.held, text, end: t } // newer revision of the held utterance
      } else if (!exactRepeat) {
        this.flushHeld()
        this.held = { text, base: 0, start: this.utteranceStart ?? t, end: t }
      }
    } else if (exactRepeat) {
      return // late repeat of something already published
    } else if (c >= 0 && w.length > this.lastPublished.length) {
      this.held = { text, base: this.lastPublished.length, start: t, end: t } // late continuation
    } else {
      this.held = { text, base: 0, start: this.utteranceStart ?? t, end: t }
    }
    this.utteranceStart = null
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.flushHeld()
      this.refreshInterim()
    }, this.settleMs)
  }

  private flushHeld() {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
    const h = this.held
    this.held = null
    if (!h) return
    const tk = tokens(h.text)
    this.lastPublished = tk.norm
    const tail = tk.raw.slice(h.base).join(' ')
    if (tail) this.pushSegment(tail, h.start, h.end)
  }

  private onError(e: SpeechErrorEvent) {
    if (e.error === 'no-speech' || e.error === 'aborted') return // normal; onend restarts
    this.set({ error: ERRORS[e.error] ?? `Speech recognition error: ${e.error}` })
    if (FATAL.has(e.error)) {
      this.wanted = false
      this.set({ status: 'error' })
    }
  }

  private onEnd() {
    this.rec = null
    this.commitInterim()
    this.flushHeld()
    if (!this.wanted) {
      if (this.snap.status === 'listening') this.set({ status: 'stopped' })
      return
    }
    if (++this.restarts > 50) {
      this.wanted = false
      this.set({ status: 'error', error: 'Speech recognition keeps stopping; please try again.' })
      return
    }
    this.open()
  }

  private commitInterim() {
    // The recognizer stopped mid-utterance: treat the interim text as final (same merge rules).
    const text = this.interimText
    this.interimText = ''
    if (text) this.acceptFinal(text, this.now() - this.startedAt)
    this.set({ interim: '' })
  }

  private pushSegment(text: string, start: number, end: number) {
    const seg: Segment = {
      id: `ws-${this.seq}`,
      sequence: this.seq,
      start_ms: Math.max(0, Math.round(start)),
      end_ms: Math.max(0, Math.round(end)),
      text,
      status: 'ready',
    }
    this.seq++
    this.set({ segments: [...this.snap.segments, seg] })
    this.segmentListeners.forEach((l) => l(seg))
  }

  private set(patch: Partial<WebSpeechSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }
}

/** App-wide instance so navigating between pages never stops listening. */
let shared: WebSpeechTranscriber | null = null
export function sharedWebSpeech(): WebSpeechTranscriber {
  shared ??= new WebSpeechTranscriber()
  return shared
}
