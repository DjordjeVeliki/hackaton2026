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

    expect(await screen.findByText(/Start transcription when you begin your talk/)).toBeInTheDocument()
    // Speakers do not ask questions.
    expect(screen.queryByRole('button', { name: 'Ask a question' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Start transcription/ }))
    await screen.findByRole('button', { name: /Stop transcription/ })
    expect(FakeRecognition.last?.lang).toBe('en-US')

    FakeRecognition.last!.say('Danas govorimo o zero trust arhitekturi.')
    // Published after a short settle pause (the browser may still extend the utterance).
    await waitFor(() => expect(published).toEqual([expect.objectContaining({ sequence: 0, text: 'Danas govorimo o zero trust arhitekturi.' })]), {
      timeout: 4000,
    })
    expect(await screen.findByText('Danas govorimo o zero trust arhitekturi.', {}, { timeout: 4000 })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Stop transcription/ }))
    await waitFor(() => expect(calls.some((c) => c.path === '/recordings/r1/stop')).toBe(true))
    await screen.findByRole('button', { name: /Start transcription/ })
  })
})

describe('speakers are never asked for a CV', () => {
  const speakerRoutes: Route[] = [
    ({ path }) => (path === '/me' ? json(200, { user_id: 'sp', display_name: 'Govornik', roles: ['speaker'] }) : undefined),
    ({ path }) => (path === '/events' ? json(200, { items: [{ id: 'e1', title: 'Konferencija' }], next_cursor: null }) : undefined),
    ({ path }) => (path === '/events/e1/join' ? json(200, { joined: true }) : undefined),
    ({ path }) =>
      path === '/events/e1/talks'
        ? json(200, { items: [{ id: 't1', title: 'Zero trust', speaker_name: 'Govornik', status: 'scheduled' }] })
        : undefined,
  ]

  it('joining goes straight to the talks, with no profile/CV card or Profile tab', async () => {
    const { fn, calls } = fakeFetch(speakerRoutes)
    const user = userEvent.setup()
    renderAt('/events', makeServices(fn))
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    expect(await screen.findByText('Zero trust')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/events/e1')
    expect(screen.queryByText('Your profile')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Profile/ })).not.toBeInTheDocument()
    expect(calls.some((c) => c.path === '/events/e1/profile')).toBe(false)
  })

  it('the CV and profile pages redirect a speaker to the talks', async () => {
    const { fn, calls } = fakeFetch(speakerRoutes)
    renderAt('/events/e1/cv', makeServices(fn))
    expect(await screen.findByText('Zero trust')).toBeInTheDocument()
    expect(screen.queryByText('Would you like to add your CV?')).not.toBeInTheDocument()
    expect(calls.some((c) => c.path === '/events/e1/profile')).toBe(false)
  })
})

describe('only attendees are asked for a CV', () => {
  for (const roles of [['organizer'], ['sponsor']]) {
    it(`${roles[0]}: no CV step, no profile card, no Profile tab, CV page redirects`, async () => {
      const { fn, calls } = fakeFetch([
        ({ path }) => (path === '/me' ? json(200, { user_id: 'x', display_name: 'X', roles }) : undefined),
        ({ path }) => (path === '/events' ? json(200, { items: [{ id: 'e1', title: 'Conference' }], next_cursor: null }) : undefined),
        ({ path }) => (path === '/events/e1/join' ? json(200, { joined: true }) : undefined),
        ({ path }) => (path === '/events/e1/talks' ? json(200, { items: [{ id: 't1', title: 'Zero trust', speaker_name: 'S', status: 'scheduled' }] }) : undefined),
      ])
      const user = userEvent.setup()
      renderAt('/events', makeServices(fn))
      await user.click(await screen.findByRole('button', { name: 'Join' }))
      expect(await screen.findByText('Zero trust')).toBeInTheDocument()
      expect(window.location.pathname).toBe('/events/e1')
      expect(screen.queryByText('Your profile')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Profile/ })).not.toBeInTheDocument()
      window.history.pushState({}, '', '/events/e1/cv')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await waitFor(() => expect(window.location.pathname).toBe('/events/e1'))
      expect(calls.some((c) => c.path === '/events/e1/profile')).toBe(false)
    })
  }
})
