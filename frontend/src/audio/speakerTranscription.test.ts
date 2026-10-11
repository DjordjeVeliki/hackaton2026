import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { SpeakerTranscription } from './speakerTranscription'
import { WebSpeechTranscriber, type SpeechRecognitionLike, type SpeechResultEvent } from './webSpeech'

class Fake implements SpeechRecognitionLike {
  static last: Fake
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((e: SpeechResultEvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    Fake.last = this
  }
  start() {}
  stop() {}
  abort() {}
  say(text: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] as unknown as SpeechResultEvent['results'] })
  }
}

function setup(textSegment: (rid: string, seg: { sequence: number; text: string }) => Promise<unknown>) {
  const api = {
    startRecording: vi.fn(async () => ({ recording_id: 'r1' })),
    textSegment: vi.fn(textSegment),
    stopRecording: vi.fn(async () => ({ status: 'stopped' })),
  }
  const transcriber = new WebSpeechTranscriber({ ctor: Fake, now: () => 0 })
  const c = new SpeakerTranscription({ api, transcriber, sleep: async () => {} })
  return { api, c }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('SpeakerTranscription', () => {
  it('publishes finalized utterances in order with contiguous sequences', async () => {
    const { api, c } = setup(async () => ({}))
    await c.start('t1', 'en-US')
    expect(c.getSnapshot()).toMatchObject({ status: 'live', recordingId: 'r1', talkId: 't1' })
    expect(Fake.last.lang).toBe('en-US')
    Fake.last.say('first')
    Fake.last.say('second')
    await flush()
    await flush()
    expect(api.textSegment.mock.calls.map(([, s]) => [s.sequence, s.text])).toEqual([[0, 'first'], [1, 'second']])
    expect(c.getSnapshot()).toMatchObject({ sent: 2, pending: 0 })
  })

  it('retries network failures with the same sequence', async () => {
    let fail = 2
    const { api, c } = setup(async () => {
      if (fail-- > 0) throw new ApiError(0, 'NETWORK', 'offline', null)
      return {}
    })
    await c.start('t1')
    Fake.last.say('hello')
    await vi.waitFor(() => expect(api.textSegment).toHaveBeenCalledTimes(3))
    expect(api.textSegment.mock.calls.every(([, s]) => s.sequence === 0)).toBe(true)
    await vi.waitFor(() => expect(c.getSnapshot().sent).toBe(1))
  })

  it('drops a rejected utterance without burning its sequence', async () => {
    let n = 0
    const { api, c } = setup(async () => {
      if (n++ === 0) throw new ApiError(400, 'INVALID_CHUNK_TIMING', 'bad timing', null)
      return {}
    })
    await c.start('t1')
    Fake.last.say('rejected')
    Fake.last.say('accepted')
    await vi.waitFor(() => expect(api.textSegment).toHaveBeenCalledTimes(2))
    expect(api.textSegment.mock.calls.map(([, s]) => [s.sequence, s.text])).toEqual([[0, 'rejected'], [0, 'accepted']])
  })

  it('stop flushes the utterance in progress before stopping the recording', async () => {
    const { api, c } = setup(async () => ({}))
    await c.start('t1')
    Fake.last.say('unfinished thought', false)
    await c.stop()
    expect(api.textSegment.mock.calls.map(([, s]) => s.text)).toEqual(['unfinished thought'])
    expect(api.stopRecording).toHaveBeenCalledWith('r1')
    expect(c.getSnapshot().status).toBe('stopped')
  })

  it('reports a failed start without listening', async () => {
    const { api, c } = setup(async () => ({}))
    api.startRecording.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Join the event first', null))
    await c.start('t1')
    expect(c.getSnapshot()).toMatchObject({ status: 'error', error: 'Join the event first' })
  })
})
