import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { SpeechRecognitionLike, SpeechResultEvent } from '../audio/webSpeech'
import { fakeFetch, json, makeServices, renderAt, type Route } from './harness'

// Fake browser recognizer, installed before the app creates its shared transcriber.
class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((e: SpeechResultEvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    FakeRecognition.last = this
  }
  start() {}
  stop() {}
  abort() {}
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] as unknown as SpeechResultEvent['results'] })
  }
}
;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition

describe('speaker live transcription', () => {
  it('speaker starts, recognized text is published and shown, then stops', async () => {
    let started = false
    let stopped = false
    const published: { sequence: number; text: string }[] = []
    const routes: Route[] = [
      ({ path }) => (path === '/me' ? json(200, { user_id: 'sp', display_name: 'Govornik', roles: ['speaker'] }) : undefined),
      ({ path }) =>
        path === '/events/e1/talks'
          ? json(200, { items: [{ id: 't1', title: 'Zero trust', speaker_name: 'Govornik', status: 'scheduled' }] })
          : undefined,
      ({ path }) =>
        path === '/talks/t1/transcript'
          ? json(200, started ? { recording_id: 'r1', status: stopped ? 'stopped' : 'active' } : { recording_id: null, status: 'none' })
          : undefined,
      ({ path, method }) => {
        if (path !== '/talks/t1/recordings' || method !== 'POST') return undefined
        started = true
        return json(200, { recording_id: 'r1', mode: 'live', started_at: '2026-10-11T10:00:00Z', sample_rate_hz: 16000, chunk_seconds: 5 })
      },
      ({ path, body }) => {
        if (path !== '/recordings/r1/text-segments') return undefined
        published.push(body as { sequence: number; text: string })
        return json(202, { sequence: (body as { sequence: number }).sequence, status: 'accepted' })
      },
      ({ path }) =>
        path.startsWith('/recordings/r1/segments')
          ? json(200, {
              items: published.map((p) => ({ id: `r1-${p.sequence}`, sequence: p.sequence, start_ms: 0, end_ms: 1, text: p.text, status: 'ready' })),
              next_after_sequence: published.length - 1,
              processing_lag_ms: 0,
            })
          : undefined,
      ({ path }) => {
        if (path !== '/recordings/r1/stop') return undefined
        stopped = true
        return json(200, { status: 'stopped' })
      },
    ]
    const { fn, calls } = fakeFetch(routes)
    const user = userEvent.setup()
    renderAt('/events/e1/talks/t1', makeServices(fn))

    expect(await screen.findByText(/Pokrenite transkripciju kada počnete predavanje/)).toBeInTheDocument()
    // Speakers do not ask questions.
    expect(screen.queryByRole('button', { name: 'Postavi pitanje' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Pokreni transkripciju/ }))
    await screen.findByRole('button', { name: /Zaustavi transkripciju/ })
    expect(FakeRecognition.last?.lang).toBe('sr-RS')

    FakeRecognition.last!.say('Danas govorimo o zero trust arhitekturi.')
    await waitFor(() => expect(published).toEqual([expect.objectContaining({ sequence: 0, text: 'Danas govorimo o zero trust arhitekturi.' })]))
    expect(await screen.findByText('Danas govorimo o zero trust arhitekturi.', {}, { timeout: 4000 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Zaustavi transkripciju/ }))
    await waitFor(() => expect(calls.some((c) => c.path === '/recordings/r1/stop')).toBe(true))
    await screen.findByRole('button', { name: /Pokreni transkripciju/ })
  })
})
