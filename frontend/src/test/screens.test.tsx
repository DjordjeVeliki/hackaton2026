import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { apiError, fakeFetch, json, makeServices, ME, renderAt, TALKS, type Route } from './harness'

const base: Route[] = [
  ({ path }) => (path === '/me' ? json(200, ME) : undefined),
  ({ path }) => (path === '/events/e1/talks' ? json(200, TALKS) : undefined),
]

const profileRoute = (p: Record<string, unknown>): Route => ({ path }) =>
  path === '/events/e1/profile' ? json(200, p) : undefined

const liveTalk: Route[] = [
  ({ path }) => (path === '/talks/t1/transcript' ? json(200, { recording_id: 'r1', status: 'active' }) : undefined),
  ({ path }) =>
    path.startsWith('/recordings/r1/segments')
      ? json(200, {
          items: [{ id: 's0', sequence: 0, start_ms: 0, end_ms: 4000, text: 'Govornik objašnjava HNSW indekse.', status: 'ready' }],
          next_after_sequence: 0,
          processing_lag_ms: 0,
        })
      : undefined,
]

const PROFILE_NA = { user_id: 'u1', cv_status: 'missing', expertise_status: 'N/A', interests: [], eligible_for_top5: false }

describe('CV states and N/A availability', () => {
  it('missing CV shows N/A, not eligible, and offers skipping', async () => {
    const { fn } = fakeFetch([...base, profileRoute(PROFILE_NA)])
    renderAt('/events/e1/cv', makeServices(fn))
    expect(await screen.findByText(/N\/A — no processed CV/)).toBeInTheDocument()
    expect(screen.getByText('Not eligible for recommendations')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skip for now' })).toHaveAttribute('href', '/events/e1')
  })

  it('failed CV explains that all talk features still work', async () => {
    const { fn } = fakeFetch([...base, profileRoute({ ...PROFILE_NA, cv_status: 'failed' })])
    renderAt('/events/e1/profile', makeServices(fn))
    expect(await screen.findByText('CV processing failed')).toBeInTheDocument()
    expect(screen.getByText(/all talk features still work/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove CV' })).toBeEnabled()
  })

  it('attendee without CV can use transcript, catch-up, explanations and questions', async () => {
    const { fn } = fakeFetch([...base, profileRoute(PROFILE_NA), ...liveTalk])
    renderAt('/events/e1/talks/t1', makeServices(fn))
    expect(await screen.findByText('Govornik objašnjava HNSW indekse.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /I lost the thread/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Explain a term' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ask a question' })).toBeEnabled()
    // Only the speaker starts transcription; attendees never get a recording control.
    expect(screen.queryByRole('button', { name: /Start transcription/ })).not.toBeInTheDocument()
  })

  it('before the speaker starts, attendees are told the transcript will appear', async () => {
    const { fn } = fakeFetch([...base, ({ path }) => (path === '/talks/t1/transcript' ? json(200, { recording_id: null, status: 'none' }) : undefined)])
    renderAt('/events/e1/talks/t1', makeServices(fn))
    expect(await screen.findByText(/appear automatically as soon as the speaker starts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /I lost the thread/ })).not.toBeInTheDocument()
  })
})

describe('no hidden scores in attendee view', () => {
  it('ignores private fields even if a server leaks them', async () => {
    const leaky = {
      user_id: 'u1',
      cv_status: 'parsed',
      expertise_status: 'estimated',
      interests: [{ topic: 'Rust', source: 'cv', score: 93 }],
      eligible_for_top5: true,
      cv_baseline: 81,
      expertise: 87,
      rank: 4,
    }
    const { fn } = fakeFetch([...base, profileRoute(leaky), ({ path }) => (path === '/events/e1/opportunities' ? json(200, { items: [] }) : undefined)])
    const { container } = renderAt('/events/e1/profile', makeServices(fn))
    expect(await screen.findByText('Estimated (advisory)')).toBeInTheDocument()
    await screen.findByText('Rust')
    const text = container.textContent ?? ''
    for (const n of ['93', '81', '87']) expect(text).not.toContain(n)
    // No score-like label followed by a number anywhere (the privacy disclaimer itself is fine).
    expect(text).not.toMatch(/(rang|rank|score|ocena|stručnost|expertise|relevan\w*|dubina)\s*[:#]?\s*\d/i)
  })
})

describe('question drawer', () => {
  const Q = (id: string, text: string) => ({ id, talk_id: 't1', text, submitted_at: '2026-10-10T10:00:00Z', read_status: 'unread' })

  it('reuses client_request_id on retry and never deletes text on failure', async () => {
    let posts = 0
    const ids: string[] = []
    const { fn } = fakeFetch([
      ...base,
      ({ path }) => (path === '/talks/t1/question-quota' ? json(200, { used: 0, limit: 3, remaining: 3 }) : undefined),
      ({ path, method }) => (path === '/talks/t1/questions' && method === 'GET' ? json(200, { items: [] }) : undefined),
      ({ path, method, body }) => {
        if (path !== '/talks/t1/questions' || method !== 'POST') return
        ids.push((body as { client_request_id: string }).client_request_id)
        if (++posts === 1) return apiError(503, 'UNAVAILABLE', 'Server privremeno nedostupan')
        return json(201, { question: Q('q1', 'Kako radi HNSW?'), quota: { used: 1, limit: 3, remaining: 2 } })
      },
    ])
    const user = userEvent.setup()
    renderAt('/events/e1/talks/t1', makeServices(fn))
    await user.click(await screen.findByRole('button', { name: 'Ask a question' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('0/3 questions')
    const box = within(dialog).getByLabelText('Your question')
    await user.type(box, 'Kako radi HNSW?')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText(/Sending failed/)).toBeInTheDocument()
    expect(box).toHaveValue('Kako radi HNSW?')

    await user.click(within(dialog).getByRole('button', { name: 'Send again' }))
    await within(dialog).findByText('Kako radi HNSW?', { selector: 'p' })
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
    expect(box).toHaveValue('')
    expect(within(dialog).getByText('1/3 questions')).toBeInTheDocument()
    // No AI reply / suggestion UI in the drawer.
    expect(within(dialog).queryByText(/odgovor modela|predlog|kviz/i)).toBeNull()
  })

  it('handles 409 QUESTION_LIMIT_REACHED without losing the text', async () => {
    let quota = { used: 2, limit: 3, remaining: 1 }
    const { fn } = fakeFetch([
      ...base,
      ({ path }) => (path === '/talks/t1/question-quota' ? json(200, quota) : undefined),
      ({ path, method }) =>
        path === '/talks/t1/questions' && method === 'GET' ? json(200, { items: [Q('a', 'Prvo'), Q('b', 'Drugo')] }) : undefined,
      ({ path, method }) => {
        if (path !== '/talks/t1/questions' || method !== 'POST') return
        quota = { used: 3, limit: 3, remaining: 0 } // another device used the last slot
        return apiError(409, 'QUESTION_LIMIT_REACHED', 'Limit')
      },
    ])
    const user = userEvent.setup()
    renderAt('/events/e1/talks/t1', makeServices(fn))
    await user.click(await screen.findByRole('button', { name: 'Ask a question' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('2/3 questions')
    const box = within(dialog).getByLabelText('Your question')
    await user.type(box, 'Treće pitanje')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText(/You have used all 3 questions/)).toBeInTheDocument()
    expect(box).toHaveValue('Treće pitanje')
    await within(dialog).findByText('3/3 questions')
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
  })
})

describe('drawers over the live transcript', () => {
  it('opening and closing question / catch-up / explanation drawers keeps the transcript', async () => {
    const { fn } = fakeFetch([
      ...base,
      ...liveTalk,
      ({ path }) => (path === '/talks/t1/question-quota' ? json(200, { used: 0, limit: 3, remaining: 3 }) : undefined),
      ({ path, method }) => (path === '/talks/t1/questions' && method === 'GET' ? json(200, { items: [] }) : undefined),
    ])
    const user = userEvent.setup()
    renderAt('/events/e1/talks/t1', makeServices(fn))
    await screen.findByText('Govornik objašnjava HNSW indekse.')
    for (const name of ['Ask a question', 'I lost the thread', 'Explain a term']) {
      await user.click(screen.getByRole('button', { name: new RegExp(name) }))
      await screen.findByRole('dialog')
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    expect(screen.getByText('Govornik objašnjava HNSW indekse.')).toBeInTheDocument()
  })
})

describe('interests combobox', () => {
  it('suggests CV topics, filters while typing, and saves the pick as your interest', async () => {
    const profile = {
      user_id: 'u1',
      cv_status: 'parsed',
      expertise_status: 'estimated',
      interests: [
        { topic: 'Vector databases', source: 'cv' },
        { topic: 'Kubernetes', source: 'cv' },
        { topic: 'Search latency', source: 'question' },
      ],
      eligible_for_top5: true,
    }
    const { fn, calls } = fakeFetch([
      ...base,
      ({ path }) => (path === '/events/e1/opportunities' ? json(200, { items: [] }) : undefined),
      ({ path, method, body }) =>
        path === '/events/e1/profile' && method === 'PATCH'
          ? json(200, {
              ...profile,
              interests: [
                ...(body as { declared_interests: string[] }).declared_interests.map((t) => ({ topic: t, source: 'declared' })),
                { topic: 'Kubernetes', source: 'cv' },
                { topic: 'Search latency', source: 'question' },
              ],
            })
          : undefined,
      profileRoute(profile), // GET (the PATCH route above answers first)
    ])
    const user = userEvent.setup()
    renderAt('/events/e1/profile', makeServices(fn))
    const box = await screen.findByRole('combobox', { name: 'Add an interest' })
    await user.click(box)
    const list = screen.getByRole('listbox')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Vector databases', 'Kubernetes', 'Search latency'])
    await user.type(box, 'vec')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Vector databases', 'Add “vec”'])
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ declared_interests: ['Vector databases'] }),
    )
    expect(await screen.findByRole('button', { name: 'Remove interest Vector databases' })).toBeInTheDocument()
  })
})
