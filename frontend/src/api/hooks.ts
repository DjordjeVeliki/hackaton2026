import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '../services'
import { EMPTY_TRANSCRIPT, mergeSegmentPage, type TranscriptState } from './transcript'
import type { CvStatus } from './types'

export const qk = {
  me: ['me'] as const,
  events: ['events'] as const,
  talks: (eventId: string) => ['talks', eventId] as const,
  profile: (eventId: string) => ['profile', eventId] as const,
  segments: (recordingId: string) => ['segments', recordingId] as const,
  talkTranscript: (talkId: string) => ['talk-transcript', talkId] as const,
  quota: (talkId: string) => ['quota', talkId] as const,
  myQuestions: (talkId: string) => ['my-questions', talkId] as const,
  speakerQuestions: (eventId: string) => ['speaker-questions', eventId] as const,
  opportunities: (eventId: string) => ['opportunities', eventId] as const,
  consent: (eventId: string, recipientId: string) => ['consent', eventId, recipientId] as const,
  recommendations: (eventId: string) => ['recommendations', eventId] as const,
  metrics: (eventId: string) => ['metrics', eventId] as const,
}

export function useMe() {
  const api = useApi()
  return useQuery({ queryKey: qk.me, queryFn: api.me, staleTime: 5 * 60_000 })
}

export function hasRole(roles: string[] | undefined, role: string) {
  return !!roles?.includes(role)
}

/** A sponsor account that does not also attend, speak or organize: sees candidates, not talks. */
export function isSponsorOnly(roles: string[] | undefined) {
  return hasRole(roles, 'sponsor') && !['attendee', 'speaker', 'organizer'].some((r) => hasRole(roles, r))
}

/** CV, interests and sponsor sharing are for attendees only (not speakers, organizers or sponsors). */
export function isAttendee(roles: string[] | undefined) {
  return hasRole(roles, 'attendee')
}

export function useTalks(eventId: string, enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: qk.talks(eventId), queryFn: () => api.talks(eventId), refetchInterval: 30_000, enabled })
}

const CV_PENDING: CvStatus[] = ['uploaded', 'processing']

/** Polls while the CV is being processed, then stops. */
export function useProfile(eventId: string, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: qk.profile(eventId),
    enabled,
    queryFn: () => api.profile(eventId),
    refetchInterval: (q) => (q.state.data && CV_PENDING.includes(q.state.data.cv_status) ? 2000 : false),
  })
}

/**
 * Incremental transcript: each poll asks only for sequences after the cursor
 * and merges unseen ones into the cached state (kept across drawers/screens).
 */
/** v1.1: find the talk's live transcript; polls until it exists and while it is active. */
export function useTalkTranscript(talkId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.talkTranscript(talkId),
    queryFn: () => api.talkTranscript(talkId),
    refetchInterval: (q) => (q.state.data?.status === 'stopped' ? 15000 : 4000),
  })
}

export function useTranscript(recordingId: string | null, poll: boolean) {
  const api = useApi()
  const qc = useQueryClient()
  return useQuery<TranscriptState>({
    queryKey: qk.segments(recordingId ?? 'none'),
    enabled: !!recordingId,
    queryFn: async () => {
      const key = qk.segments(recordingId!)
      let state = qc.getQueryData<TranscriptState>(key) ?? EMPTY_TRANSCRIPT
      for (let i = 0; i < 10; i++) {
        const page = await api.segments(recordingId!, state.cursor, 50)
        state = mergeSegmentPage(state, page)
        if (page.items.length < 50) break
      }
      return state
    },
    // 1 s while the talk is live so attendees see the speaker's words with little delay.
    refetchInterval: (q) => (poll ? 1000 : (q.state.data?.lagMs ?? 0) > 0 ? 2000 : false),
    refetchIntervalInBackground: true,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: EMPTY_TRANSCRIPT,
  })
}
