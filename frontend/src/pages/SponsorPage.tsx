import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { qk } from '../api/hooks'
import type { Recommendation } from '../api/types'
import { Badge, Button, EmptyState, ErrorAlert, Field, inputClass, Spinner } from '../components/ui'
import { fmtClock } from '../lib/format'
import { useApi } from '../services'

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function SponsorPage() {
  const { eventId = '' } = useParams()
  const api = useApi()
  const opps = useQuery({ queryKey: qk.opportunities(eventId), queryFn: () => api.opportunities(eventId) })
  // Refreshes on its own so candidates appear as soon as the organizer approves the lists.
  const recs = useQuery({ queryKey: qk.recommendations(eventId), queryFn: () => api.recommendations(eventId), refetchInterval: 15_000 })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Your top candidates</h1>
        <p className="text-slate-600">
          Up to five attendees per opportunity, ranked from their CV and the questions they asked during the conference. Only people
          who consented are shown. Recommendations are advisory — you decide whom to contact.
        </p>
      </div>

      {recs.isPending && <Spinner />}
      {recs.isError && <ErrorAlert error={recs.error} onRetry={() => recs.refetch()} />}
      {recs.data?.length === 0 && (
        <EmptyState>No candidates yet. They appear here as soon as the organizer approves the lists.</EmptyState>
      )}
      {recs.data && recs.data.length > 0 && (
        <ol className="space-y-3" aria-label="Recommended candidates">
          {recs.data.map((r) => (
            <li key={r.participant_id}>
              <RecommendationDetail eventId={eventId} rec={r} />
            </li>
          ))}
        </ol>
      )}

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold">Your opportunities ({opps.data?.length ?? 0})</summary>
        <div className="mt-3">
          {opps.isPending && <Spinner />}
          {opps.isError && <ErrorAlert error={opps.error} onRetry={() => opps.refetch()} />}
          {opps.data?.length === 0 && <EmptyState>No opportunities yet. Post one so candidates can be matched to it.</EmptyState>}
          <ul className="space-y-2">
            {opps.data?.map((o) => (
              <li key={o.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.title}</span>
                  <Badge tone="blue">{o.recipient_kind === 'sponsor' ? 'Sponsor' : 'Group'}</Badge>
                </div>
                {o.topics.length > 0 && <p className="text-sm text-slate-600">{o.topics.join(', ')}</p>}
              </li>
            ))}
          </ul>
          <NewOpportunity eventId={eventId} />
        </div>
      </details>
    </div>
  )
}

function NewOpportunity({ eventId }: { eventId: string }) {
  const api = useApi()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [topics, setTopics] = useState('')
  const [skills, setSkills] = useState('')
  const m = useMutation({
    mutationFn: () => api.createOpportunity(eventId, { title: title.trim(), topics: splitList(topics), required_skills: splitList(skills) }),
    onSuccess: () => {
      setTitle('')
      setTopics('')
      setSkills('')
      void qc.invalidateQueries({ queryKey: qk.opportunities(eventId) })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim()) m.mutate()
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-slate-200 pt-4">
      <h3 className="font-semibold">New opportunity</h3>
      <Field label="Title" htmlFor="opp-title">
        <input id="opp-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
      </Field>
      <Field label="Topics" htmlFor="opp-topics" hint="Comma-separated">
        <input id="opp-topics" className={inputClass} value={topics} onChange={(e) => setTopics(e.target.value)} />
      </Field>
      <Field label="Required skills" htmlFor="opp-skills" hint="Comma-separated">
        <input id="opp-skills" className={inputClass} value={skills} onChange={(e) => setSkills(e.target.value)} />
      </Field>
      <Button type="submit" disabled={m.isPending || !title.trim()}>
        {m.isPending ? 'Saving…' : 'Post opportunity'}
      </Button>
      {m.isSuccess && <p role="status" className="text-sm text-green-800">Opportunity posted.</p>}
      {m.isError && <ErrorAlert error={m.error} />}
    </form>
  )
}

function RecommendationDetail({ eventId, rec }: { eventId: string; rec: Recommendation }) {
  const api = useApi()
  const download = useMutation({
    mutationFn: () => api.participantCv(eventId, rec.participant_id),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cv-${rec.display_name.replace(/[^\p{L}\p{N}]+/gu, '-')}`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    },
  })
  return (
    <article className="space-y-3 rounded-lg border border-slate-200 p-3" aria-label={`Details: ${rec.display_name}`}>
      <h3 className="text-lg font-semibold">{rec.display_name}</h3>
      {rec.interests.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {rec.interests.map((i) => (
            <li key={`${i.source}:${i.topic}`}>
              <Badge>{i.topic}</Badge>
            </li>
          ))}
        </ul>
      )}
      {rec.reasons.length > 0 && (
        <div>
          <h4 className="text-sm font-medium">Why recommended</h4>
          <ul className="list-disc pl-5 text-sm">
            {rec.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="text-sm font-medium">Shared questions</h4>
        {rec.questions.length === 0 ? (
          <p className="text-sm text-slate-600">The attendee has not shared questions.</p>
        ) : (
          <ul className="space-y-2">
            {rec.questions.map((q) => (
              <li key={q.id} className="rounded bg-slate-50 p-2 text-sm">
                <p className="whitespace-pre-wrap break-words">{q.text}</p>
                <p className="text-xs text-slate-500">{fmtClock(q.submitted_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rec.cv_available ? (
        <Button variant="secondary" onClick={() => download.mutate()} disabled={download.isPending}>
          {download.isPending ? 'Downloading…' : 'Download CV'}
        </Button>
      ) : (
        <p className="text-sm text-slate-600">The CV is not shared with you.</p>
      )}
      {download.isError && <ErrorAlert error={download.error} />}
    </article>
  )
}
