import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { isAttendee, isSponsorOnly, qk, useMe } from '../api/hooks'
import { Button, Card, EmptyState, ErrorAlert, Spinner } from '../components/ui'
import { useApi } from '../services'

export function EventsPage() {
  const api = useApi()
  const nav = useNavigate()
  const me = useMe()
  const roles = me.data?.roles
  const events = useInfiniteQuery({
    queryKey: qk.events,
    queryFn: ({ pageParam }) => api.events(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })
  const join = useMutation({
    // Joining is idempotent, so the one button also re-opens an event you already joined.
    mutationFn: async (eventId: string) => {
      await api.joinEvent(eventId)
      if (isSponsorOnly(roles)) return `/sponsor/events/${eventId}`
      // Only attendees get the optional CV step, and only while they have no CV yet.
      if (isAttendee(roles) && (await api.profile(eventId)).cv_status === 'missing') return `/events/${eventId}/cv`
      return `/events/${eventId}`
    },
    onSuccess: (to) => nav(to),
  })

  const items = events.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Events</h1>
      {events.isPending && <Spinner />}
      {events.isError && <ErrorAlert error={events.error} onRetry={() => events.refetch()} />}
      {events.isSuccess && items.length === 0 && <EmptyState>No events available right now.</EmptyState>}
      <ul className="space-y-3">
        {items.map((e) => (
          <li key={e.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{e.title}</h2>
                <div className="flex gap-2">
                  <Button onClick={() => join.mutate(e.id)} disabled={join.isPending && join.variables === e.id}>
                    {join.isPending && join.variables === e.id ? 'Joining…' : 'Join'}
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {join.isError && <ErrorAlert error={join.error} />}
      {events.hasNextPage && (
        <Button variant="secondary" onClick={() => events.fetchNextPage()} disabled={events.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  )
}
