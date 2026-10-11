import { Link, Navigate, useParams } from 'react-router-dom'
import { isAttendee, useMe, useProfile } from '../api/hooks'
import { CvPanel } from '../components/CvPanel'
import { Card, ErrorAlert, Spinner } from '../components/ui'

/** Optional step right after joining an event. Skipping is always allowed. */
export function CvOnboardingPage() {
  const { eventId = '' } = useParams()
  const me = useMe()
  const attendee = isAttendee(me.data?.roles)
  const profile = useProfile(eventId, attendee)
  // CV is uploaded only by attendees; speakers, organizers and sponsors are sent to the talks.
  if (me.isSuccess && !attendee) return <Navigate to={`/events/${eventId}`} replace />
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Would you like to add your CV?</h1>
      <p className="text-slate-700">
        Your CV is optional. Without it you still get the transcript, “I lost the thread”, term explanations and questions to the speaker. A CV only lets you be recommended to sponsors, with your consent.
      </p>
      <Card>
        {profile.isPending && <Spinner />}
        {profile.isError && <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />}
        {profile.data && <CvPanel eventId={eventId} profile={profile.data} />}
      </Card>
      <div className="flex justify-end">
        <Link
          to={`/events/${eventId}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 font-medium hover:bg-slate-50"
        >
          {profile.data?.cv_status === 'missing' ? 'Skip for now' : 'Continue to talks'}
        </Link>
      </div>
    </div>
  )
}
