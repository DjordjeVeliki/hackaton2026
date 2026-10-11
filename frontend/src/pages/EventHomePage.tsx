import { Link, Navigate, useParams } from 'react-router-dom'
import { isAttendee, isSponsorOnly, useMe, useProfile, useTalks } from '../api/hooks'
import type { TalkStatus } from '../api/types'
import { ProfileStatus } from '../components/CvPanel'
import { Badge, Card, EmptyState, ErrorAlert, Spinner } from '../components/ui'

const TALK_STATUS: Record<TalkStatus, { text: string; tone: 'green' | 'slate' | 'amber' }> = {
  live: { text: 'Live', tone: 'green' },
  scheduled: { text: 'Scheduled', tone: 'amber' },
  ended: { text: 'Ended', tone: 'slate' },
}

export function EventHomePage() {
  const { eventId = '' } = useParams()
  const me = useMe()
  const sponsorOnly = isSponsorOnly(me.data?.roles)
  const talks = useTalks(eventId, me.isSuccess && !sponsorOnly)
  const attendee = isAttendee(me.data?.roles)
  const profile = useProfile(eventId, attendee)

  // Sponsors join the event but never see talks: their page is the candidate list.
  if (sponsorOnly) return <Navigate to={`/sponsor/events/${eventId}`} replace />

  return (
    <div className="space-y-4">
      {attendee && (
      <Card
        title="Your profile"
        actions={
          <Link to={`/events/${eventId}/profile`} className="text-sm font-medium text-brand-700 underline">
            Edit CV, interests and sharing
          </Link>
        }
      >
        {profile.isPending && <Spinner />}
        {profile.isError && <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />}
        {profile.data && <ProfileStatus profile={profile.data} />}
      </Card>
      )}

      <h1 className="text-2xl font-bold">Talks</h1>
      {talks.isPending && <Spinner />}
      {talks.isError && <ErrorAlert error={talks.error} onRetry={() => talks.refetch()} />}
      {talks.data?.length === 0 && <EmptyState>This event has no talks yet.</EmptyState>}
      <ul className="space-y-3">
        {talks.data?.map((t) => (
          <li key={t.id}>
            <Link
              to={`/events/${eventId}/talks/${t.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-600"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{t.title}</h2>
                  <p className="text-sm text-slate-600">{t.speaker_name}</p>
                </div>
                <Badge tone={TALK_STATUS[t.status].tone}>{TALK_STATUS[t.status].text}</Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
