import { useQueryClient } from '@tanstack/react-query'
import { useState, useSyncExternalStore } from 'react'
import type { ApiClient } from '../api/client'
import { qk } from '../api/hooks'
import { SpeakerTranscription } from '../audio/speakerTranscription'
import { useApi } from '../services'
import { Button, Notice } from './ui'

const controllers = new WeakMap<ApiClient, SpeakerTranscription>()

/** App-wide controller per API client, so navigating never stops a live talk. */
export function useSpeakerTranscription() {
  const api = useApi()
  let c = controllers.get(api)
  if (!c) {
    c = new SpeakerTranscription({ api })
    controllers.set(api, c)
  }
  const snap = useSyncExternalStore(c.subscribe, c.getSnapshot)
  const speech = useSyncExternalStore(c.speech.subscribe, c.speech.getSnapshot)
  return { controller: c, snap, speech }
}

const LANGS = [
  { value: 'en-US', label: 'EN' },
  { value: 'sr-RS', label: 'SR' },
  { value: 'hr-HR', label: 'HR' },
]

/** Speaker-only: one large start/stop control for the talk's live transcript. */
export function SpeakerLive({ talkId }: { talkId: string }) {
  const { controller, snap, speech } = useSpeakerTranscription()
  const qc = useQueryClient()
  const [lang, setLang] = useState('en-US')
  const refreshSource = () => void qc.invalidateQueries({ queryKey: qk.talkTranscript(talkId) })
  const mine = snap.talkId === talkId
  const live = mine && (snap.status === 'live' || snap.status === 'starting')
  const busyElsewhere = !mine && controller.isActive

  if (!controller.supported) {
    return <Notice tone="warn">This browser does not support speech recognition. Open Cuevia in Chrome or Edge.</Notice>
  }
  if (busyElsewhere) {
    return <Notice tone="warn">Transcription is already running for another talk. Stop it there first.</Notice>
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Talk transcription">
      {live ? (
        <>
          <div className="flex items-center justify-between gap-3" role="status" aria-live="polite">
            <span className="flex items-center gap-2 font-semibold text-red-700">
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" aria-hidden />
              {snap.status === 'starting' ? 'Starting…' : 'Live'}
            </span>
            <span className="text-sm text-slate-600 tabular-nums">
              {snap.sent} sent{snap.pending > 0 ? ` · ${snap.pending} pending` : ''}
            </span>
          </div>
          {speech.interim && <p className="line-clamp-2 text-base text-slate-500 italic">{speech.interim}…</p>}
          <Button className="min-h-14 w-full text-lg" variant="secondary" onClick={() => void controller.stop().then(refreshSource)}>
            ■ Stop transcription
          </Button>
        </>
      ) : (
        <>
          <Button
            className="min-h-14 w-full text-lg"
            disabled={snap.status === 'stopping'}
            onClick={() => void controller.start(talkId, lang).then(refreshSource)}
          >
            {snap.status === 'stopping' ? 'Finishing…' : '▶ Start transcription'}
          </Button>
          <div className="flex items-center justify-center gap-1" role="radiogroup" aria-label="Talk language">
            {LANGS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={lang === l.value}
                onClick={() => setLang(l.value)}
                className={`min-h-11 min-w-14 rounded-full px-4 text-sm font-medium ${
                  lang === l.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}
      {mine && snap.error && <Notice tone="warn">{snap.error}</Notice>}
      {mine && speech.error && <Notice tone="warn">{speech.error}</Notice>}
    </section>
  )
}
