import type { Segment, SegmentPage } from './types'

export interface TranscriptState {
  segments: Segment[]
  /** Value for the next `after_sequence` query parameter. */
  cursor: number
  lagMs: number
  /** The speaker's words in progress (v1.1); replaced on every poll. */
  liveText: string
}

export const EMPTY_TRANSCRIPT: TranscriptState = { segments: [], cursor: -1, lagMs: 0, liveText: '' }

/**
 * Append only unseen sequence numbers, keep order by sequence, never move the
 * cursor backwards. Gap segments are kept so the UI can show the hole honestly.
 */
export function mergeSegmentPage(prev: TranscriptState, page: SegmentPage): TranscriptState {
  const seen = new Set(prev.segments.map((s) => s.sequence))
  const fresh: Segment[] = []
  for (const s of page.items) {
    if (seen.has(s.sequence)) continue
    seen.add(s.sequence)
    fresh.push(s)
  }
  const cursor = Math.max(prev.cursor, page.next_after_sequence)
  const liveText = page.live_text ?? ''
  if (fresh.length === 0 && cursor === prev.cursor && page.processing_lag_ms === prev.lagMs && liveText === prev.liveText) return prev
  const segments = fresh.length ? [...prev.segments, ...fresh].sort((a, b) => a.sequence - b.sequence) : prev.segments
  return { segments, cursor, lagMs: page.processing_lag_ms, liveText }
}

/** Ready segments overlapping [start_ms, end_ms]. */
export function segmentsInRange(segments: Segment[], startMs: number, endMs: number): Segment[] {
  return segments.filter((s) => s.end_ms > startMs && s.start_ms < endMs)
}
