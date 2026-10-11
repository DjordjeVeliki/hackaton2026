import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { hasRole, useMe, useTalks, useTalkTranscript, useTranscript } from '../api/hooks'
import { CatchUpDrawer } from '../components/CatchUpDrawer'
import { ExplanationDrawer } from '../components/ExplanationDrawer'
import { QuestionDrawer, QuestionFab } from '../components/QuestionDrawer'
import { SpeakerLive, useSpeakerTranscription } from '../components/SpeakerLive'
import { Transcript, type TextSelection, type TranscriptHandle } from '../components/Transcript'
import { Badge, Button, ErrorAlert, Notice } from '../components/ui'

export function TalkPage() {
  const { eventId = '', talkId = '' } = useParams()
  const talks = useTalks(eventId)
  const me = useMe()
  const talk = talks.data?.find((t) => t.id === talkId)
  const isSpeaker = hasRole(me.data?.roles, 'speaker')
  const speaker = useSpeakerTranscription()

  // Everyone (speaker included) reads the talk's authoritative transcript from the server.
  const source = useTalkTranscript(talkId)
  const recordingId = source.data?.recording_id ?? null
  const live = source.data?.status === 'active'
  const transcript = useTranscript(recordingId, live)
  const segments = transcript.data?.segments ?? []
  const transcriptRef = useRef<TranscriptHandle>(null)

  const [selection, setSelection] = useState<TextSelection | null>(null)
  const [explain, setExplain] = useState<{ term: string; segmentId: string | null } | null>(null)
  const [catchUpOpen, setCatchUpOpen] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)

  const lastReady = [...segments].reverse().find((s) => s.status === 'ready') ?? null
  const speakingHere = speaker.snap.talkId === talkId && speaker.controller.isActive

  // Leaving the page would stop the speaker's microphone on most phones.
  useEffect(() => {
    if (!speakingHere) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [speakingHere])

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-bold sm:text-2xl">{talk?.title ?? 'Talk'}</h1>
          {talk && <p className="truncate text-slate-600">{talk.speaker_name}</p>}
        </div>
        {live ? <Badge tone="red">● Live</Badge> : talk?.status === 'ended' ? <Badge>Ended</Badge> : null}
      </header>
      {talks.isError && <ErrorAlert error={talks.error} onRetry={() => talks.refetch()} />}

      {isSpeaker && <SpeakerLive talkId={talkId} />}

      {recordingId && (
        <div className="grid grid-cols-2 gap-2">
          <Button className="min-h-12" variant="secondary" onClick={() => setCatchUpOpen(true)}>
            🧭 I lost the thread
          </Button>
          <Button className="min-h-12" variant="secondary" onClick={() => setExplain({ term: '', segmentId: lastReady?.id ?? null })}>
            Explain a term
          </Button>
        </div>
      )}

      {source.isError && <ErrorAlert error={source.error} onRetry={() => source.refetch()} />}
      {transcript.isError && <ErrorAlert error={transcript.error} onRetry={() => transcript.refetch()} />}

      {recordingId ? (
        <Transcript
          ref={transcriptRef}
          segments={segments}
          lagMs={transcript.data?.lagMs ?? 0}
          liveText={live ? (transcript.data?.liveText ?? '') : ''}
          onSelectText={setSelection}
        />
      ) : (
        source.isSuccess && (
          <Notice>
            {isSpeaker
              ? 'Start transcription when you begin your talk — the audience will see the text live on their phones.'
              : 'The transcript will appear automatically as soon as the speaker starts. You can already ask the speaker a question.'}
          </Notice>
        )
      )}

      {selection && (
        <div className="fixed inset-x-0 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] sm:bottom-24 z-20 flex justify-center px-4">
          <Button
            className="max-w-full shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setExplain({ term: selection.text, segmentId: selection.segmentId })
              setSelection(null)
            }}
          >
            <span className="truncate">Explain: “{selection.text}"</span>
          </Button>
        </div>
      )}

      {!isSpeaker && <QuestionFab onClick={() => setQuestionsOpen(true)} />}

      {!isSpeaker && <QuestionDrawer talkId={talkId} open={questionsOpen} onOpenChange={setQuestionsOpen} />}
      <CatchUpDrawer
        recordingId={recordingId}
        segments={segments}
        open={catchUpOpen}
        onOpenChange={setCatchUpOpen}
        onJump={(id) => transcriptRef.current?.jumpTo(id)}
      />
      <ExplanationDrawer
        recordingId={recordingId}
        initialTerm={explain?.term ?? ''}
        segmentId={explain?.segmentId ?? null}
        open={!!explain}
        onOpenChange={(o) => !o && setExplain(null)}
      />
    </div>
  )
}
