import { describe, expect, it, vi } from 'vitest'
import { WebSpeechTranscriber, type SpeechRecognitionLike, type SpeechResultEvent } from './webSpeech'

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((e: SpeechResultEvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {
    this.started = true
  }
  stop() {
    this.started = false
    this.onend?.()
  }
  abort() {
    this.stop()
  }
  /** Chrome-on-Android style: every growing version arrives as a new final result. */
  emitCumulativeFinals(phrase: string) {
    const ws = phrase.split(' ')
    const results: Array<[string, boolean]> = []
    for (let n = 1; n <= ws.length; n++) {
      results.push([ws.slice(0, n).join(' '), true])
      this.emit(results, results.length - 1)
    }
  }
  emit(results: Array<[string, boolean]>, resultIndex = 0) {
    const list = results.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }))
    this.onresult?.({ resultIndex, results: list as unknown as SpeechResultEvent['results'] })
  }
}

function setup() {
  FakeRecognition.instances = []
  let clock = 0
  const t = new WebSpeechTranscriber({ ctor: FakeRecognition, now: () => clock, settleMs: 5 })
  return { t, tick: (ms: number) => (clock += ms), rec: () => FakeRecognition.instances.at(-1)! }
}

describe('WebSpeechTranscriber', () => {
  it('reports unsupported browsers', () => {
    const t = new WebSpeechTranscriber({ ctor: null })
    expect(t.getSnapshot().status).toBe('unsupported')
    t.start()
    expect(t.getSnapshot().status).toBe('unsupported')
  })

  it('configures continuous interim recognition in the chosen language', () => {
    const { t, rec } = setup()
    t.start('sr-RS')
    expect(rec()).toMatchObject({ lang: 'sr-RS', continuous: true, interimResults: true, started: true })
    expect(t.getSnapshot().status).toBe('listening')
  })

  it('turns final results into timed contract-shaped segments and shows interim text', async () => {
    const { t, tick, rec } = setup()
    t.start()
    tick(1000)
    rec().emit([['Dobro veče', false]])
    expect(t.getSnapshot().interim).toBe('Dobro veče')
    expect(t.getSnapshot().segments).toEqual([])
    tick(2000)
    rec().emit([['Dobro veče svima', true]])
    // Held briefly in case the browser extends the same utterance, then published once.
    await vi.waitFor(() =>
      expect(t.getSnapshot().segments).toEqual([
        { id: 'ws-0', sequence: 0, start_ms: 1000, end_ms: 3000, text: 'Dobro veče svima', status: 'ready' },
      ]),
    )
  })

  it('restarts automatically when the browser ends the session', () => {
    const { t, rec } = setup()
    t.start()
    const first = rec()
    first.onend?.()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(rec()).not.toBe(first)
    expect(t.getSnapshot().status).toBe('listening')
  })

  it('stop keeps pending interim text as a segment and does not restart', () => {
    const { t, tick, rec } = setup()
    t.start()
    tick(500)
    rec().emit([['nedovršena rečenica', false]])
    t.stop()
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.getSnapshot().status).toBe('stopped')
    expect(t.getSnapshot().segments.map((s) => s.text)).toEqual(['nedovršena rečenica'])
  })

  it('resuming keeps the timeline; reset clears it', () => {
    const { t, rec } = setup()
    t.start()
    rec().emit([['prvi', true]])
    t.stop()
    t.start()
    rec().emit([['drugi', true]])
    t.stop()
    t.start()
    expect(t.getSnapshot().segments.map((s) => s.id)).toEqual(['ws-0', 'ws-1'])
    t.stop()
    t.reset()
    expect(t.getSnapshot().segments).toEqual([])
  })

  it('stops on permission errors with a readable message', () => {
    const { t, rec } = setup()
    t.start()
    rec().onerror?.({ error: 'not-allowed' })
    rec().onend?.()
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.getSnapshot().status).toBe('error')
    expect(t.getSnapshot().error).toMatch(/denied/)
  })

  it('ignores no-speech and keeps listening', () => {
    const { t, rec } = setup()
    t.start()
    rec().onerror?.({ error: 'no-speech' })
    rec().onend?.()
    expect(t.getSnapshot()).toMatchObject({ status: 'listening', error: null })
  })

  it('Android cumulative finals become ONE segment, not one per word', async () => {
    const { t, rec } = setup()
    const published: string[] = []
    t.onSegment((s) => published.push(s.text))
    t.start('en-US')
    rec().emitCumulativeFinals("okay so I'm speaking at about")
    rec().emit([["okay so I'm speaking at about", true]], 0) // re-sent old final
    await vi.waitFor(() => expect(published).toEqual(["okay so I'm speaking at about"]))
    expect(t.getSnapshot().segments).toHaveLength(1)
  })

  it('distinct utterances are still separate segments', async () => {
    const { t, rec } = setup()
    const published: string[] = []
    t.onSegment((s) => published.push(s.text))
    t.start()
    rec().emitCumulativeFinals('first sentence here')
    rec().emitCumulativeFinals('second one')
    await vi.waitFor(() => expect(published).toEqual(['first sentence here', 'second one']))
  })

  it('a late extension after publishing only adds the new words', async () => {
    const { t, rec } = setup()
    const published: string[] = []
    t.onSegment((s) => published.push(s.text))
    t.start()
    rec().emit([['we use vector indexes', true]])
    await vi.waitFor(() => expect(published).toEqual(['we use vector indexes']))
    rec().emit([['we use vector indexes', true], ['we use vector indexes for search', true]], 1)
    await vi.waitFor(() => expect(published).toEqual(['we use vector indexes', 'for search']))
  })

  it('the reported Android case: a revised word does not duplicate the sentence', async () => {
    const { t, rec } = setup()
    const published: string[] = []
    t.onSegment((s) => published.push(s.text))
    t.start('en-US')
    rec().emit([["hey guys sorry for being late and I'll just start by saying the", true]], 0)
    await vi.waitFor(() => expect(published).toHaveLength(1))
    // Seconds later the recognizer re-sends the whole utterance, with "the" revised to "that".
    rec().emit(
      [
        ["hey guys sorry for being late and I'll just start by saying the", true],
        ["hey guys sorry for being late and I'll just start by saying that you are all welcome here and we should administer all those", true],
      ],
      1,
    )
    rec().emit(
      [
        ["hey guys sorry for being late and I'll just start by saying the", true],
        ["hey guys sorry for being late and I'll just start by saying that you are all welcome here and we should administer all those", true],
        ['in favor of', true],
      ],
      2,
    )
    await vi.waitFor(() =>
      expect(published).toEqual([
        "hey guys sorry for being late and I'll just start by saying the",
        'you are all welcome here and we should administer all those',
        'in favor of',
      ]),
    )
  })

  it('interim text shows only the words not yet published', async () => {
    const { t, rec } = setup()
    t.start('en-US')
    rec().emit([['we use vector indexes', true]])
    await vi.waitFor(() => expect(t.getSnapshot().segments).toHaveLength(1))
    rec().emit([['we use vector indexes for fast', false]], 0)
    expect(t.getSnapshot().interim).toBe('for fast')
  })

  it('two different short sentences with the same start are both kept', async () => {
    const { t, rec } = setup()
    const published: string[] = []
    t.onSegment((s) => published.push(s.text))
    t.start()
    rec().emit([['I think that works', true]])
    await vi.waitFor(() => expect(published).toHaveLength(1))
    rec().emit([['I think that works', true], ['I think that fails', true]], 1)
    await vi.waitFor(() => expect(published).toEqual(['I think that works', 'I think that fails']))
  })
})
