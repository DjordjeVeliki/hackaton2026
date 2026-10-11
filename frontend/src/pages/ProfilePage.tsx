import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { isAttendee, qk, useMe, useProfile } from '../api/hooks'
import type { Consent, InterestSource, Opportunity, ProfilePublic } from '../api/types'
import { Combobox } from '../components/Combobox'
import { interestOptions } from '../lib/interests'
import { CvPanel } from '../components/CvPanel'
import { Badge, Button, Card, EmptyState, ErrorAlert, Notice, Spinner } from '../components/ui'
import { useApi } from '../services'

const SOURCE_LABEL: Record<InterestSource, string> = { cv: 'from CV', question: 'from questions', declared: 'added by you' }

export function ProfilePage() {
  const { eventId = '' } = useParams()
  const me = useMe()
  const attendee = isAttendee(me.data?.roles)
  const profile = useProfile(eventId, attendee)
  // CV is uploaded only by attendees; speakers, organizers and sponsors are sent to the talks.
  if (me.isSuccess && !attendee) return <Navigate to={`/events/${eventId}`} replace />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Profile</h1>
      {profile.isPending && <Spinner />}
      {profile.isError && <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />}
      {profile.data && (
        <>
          <Card title="CV">
            <CvPanel eventId={eventId} profile={profile.data} />
          </Card>
          <Card title="Interests">
            <Interests eventId={eventId} profile={profile.data} />
          </Card>
          <Card title="Sharing with sponsors and groups">
            <ConsentPanel eventId={eventId} />
          </Card>
        </>
      )}
    </div>
  )
}

function Interests({ eventId, profile }: { eventId: string; profile: ProfilePublic }) {
  const api = useApi()
  const qc = useQueryClient()
  const declared = profile.interests.filter((i) => i.source === 'declared').map((i) => i.topic)
  const save = useMutation({
    mutationFn: (list: string[]) => api.setDeclaredInterests(eventId, list),
    onSuccess: (p) => qc.setQueryData(qk.profile(eventId), p),
  })
  const add = (topic: string) => {
    if (declared.some((d) => d.toLowerCase() === topic.toLowerCase())) return
    save.mutate([...declared, topic])
  }
  const derived = profile.interests.filter((i) => i.source !== 'declared')
  // Suggestions: topics found in your CV, then from your questions, then built-in examples.
  const fromProfile = [...derived.filter((i) => i.source === 'cv'), ...derived.filter((i) => i.source === 'question')].map((i) => i.topic)
  const suggestions = interestOptions(fromProfile, declared)

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Topics derived from your CV and questions, plus topics you add yourself. We never show scores or rankings.
      </p>
      {profile.interests.length === 0 && <EmptyState>No interests yet.</EmptyState>}
      {derived.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Derived interests">
          {derived.map((i) => (
            <li key={`${i.source}:${i.topic}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm">
              {i.topic} <span className="text-xs text-slate-600">· {SOURCE_LABEL[i.source]}</span>
            </li>
          ))}
        </ul>
      )}
      {declared.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Your interests">
          {declared.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-sm text-brand-900">
              {t}
              <button
                type="button"
                className="min-h-8 min-w-8 rounded-full px-2 hover:bg-brand-100"
                aria-label={`Remove interest ${t}`}
                disabled={save.isPending}
                onClick={() => save.mutate(declared.filter((d) => d !== t))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <Combobox
        label="Add an interest"
        options={suggestions}
        onSelect={add}
        disabled={save.isPending}
        placeholder={fromProfile.length ? 'Pick a topic from your CV or the list, or type your own' : 'Pick a topic or type your own'}
      />
      {save.isError && <ErrorAlert error={save.error} />}
    </div>
  )
}

function ConsentPanel({ eventId }: { eventId: string }) {
  const api = useApi()
  const opps = useQuery({ queryKey: qk.opportunities(eventId), queryFn: () => api.opportunities(eventId) })
  if (opps.isPending) return <Spinner />
  if (opps.isError) return <ErrorAlert error={opps.error} onRetry={() => opps.refetch()} />

  const byRecipient = new Map<string, Opportunity[]>()
  for (const o of opps.data) byRecipient.set(o.recipient_id, [...(byRecipient.get(o.recipient_id) ?? []), o])

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Each sponsor or group sees your CV and your questions only if you explicitly allow it here. You can change your consent at any time; people, not the system, decide whom to contact.
      </p>
      {byRecipient.size === 0 && <EmptyState>No opportunities have been posted for this event yet.</EmptyState>}
      <ul className="space-y-3">
        {[...byRecipient.entries()].map(([rid, list]) => (
          <li key={rid}>
            <ConsentRow eventId={eventId} recipientId={rid} opportunities={list} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConsentRow({ eventId, recipientId, opportunities }: { eventId: string; recipientId: string; opportunities: Opportunity[] }) {
  const api = useApi()
  const qc = useQueryClient()
  // v1 has no GET for consents: we only know what was saved in this session.
  const saved = qc.getQueryData<Consent>(qk.consent(eventId, recipientId))
  const [allowCv, setAllowCv] = useState(saved?.allow_cv ?? false)
  const [allowQ, setAllowQ] = useState(saved?.allow_questions ?? false)
  const save = useMutation({
    mutationFn: () => api.setConsent(eventId, recipientId, allowCv, allowQ),
    onSuccess: (c) => qc.setQueryData(qk.consent(eventId, recipientId), c),
  })
  const current = save.data ?? saved
  const dirty = !current || current.allow_cv !== allowCv || current.allow_questions !== allowQ
  const kind = opportunities[0].recipient_kind === 'sponsor' ? 'Sponsor' : 'Group'
  const base = `consent-${recipientId}`

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">
        <Badge tone="blue">{kind}</Badge>
      </legend>
      <ul className="mb-2 space-y-1 text-sm">
        {opportunities.map((o) => (
          <li key={o.id}>
            <span className="font-medium">{o.title}</span>
            {o.topics.length > 0 && <span className="text-slate-600"> — {o.topics.join(', ')}</span>}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <label htmlFor={`${base}-cv`} className="flex min-h-11 items-center gap-2">
          <input id={`${base}-cv`} type="checkbox" className="h-5 w-5" checked={allowCv} onChange={(e) => setAllowCv(e.target.checked)} />
          Allow access to my CV
        </label>
        <label htmlFor={`${base}-q`} className="flex min-h-11 items-center gap-2">
          <input id={`${base}-q`} type="checkbox" className="h-5 w-5" checked={allowQ} onChange={(e) => setAllowQ(e.target.checked)} />
          Allow access to my questions
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
          {save.isPending ? 'Saving…' : 'Save consent'}
        </Button>
        <span className="text-xs text-slate-600" role="status">
          {current
            ? `Saved: CV ${current.allow_cv ? 'yes' : 'no'}, questions ${current.allow_questions ? 'yes' : 'no'}`
            : 'No choice saved in this session yet.'}
        </span>
      </div>
      {save.isError && (
        <div className="mt-2">
          <ErrorAlert error={save.error} />
        </div>
      )}
      {!current && (
        <div className="mt-2">
          <Notice>A previously saved choice is not shown (API v1 cannot read consents). Saving replaces it.</Notice>
        </div>
      )}
    </fieldset>
  )
}
