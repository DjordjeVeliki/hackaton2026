import { describe, expect, it } from 'vitest'
import { fmtEventWhen } from './format'

describe('fmtEventWhen', () => {
  it('formats a same-day event as one date and a time range', () => {
    const s = fmtEventWhen('2026-10-11T07:00:00Z', '2026-10-11T16:00:00Z')
    expect(s).toMatch(/2026 · \d{2}:\d{2}–\d{2}:\d{2}$/)
    expect(s).toContain('Oct')
  })
  it('formats a multi-day event as a range', () => {
    expect(fmtEventWhen('2026-10-11T07:00:00Z', '2026-10-13T16:00:00Z')).toMatch(/Oct 2026 \d{2}:\d{2} – .*13 Oct 2026 \d{2}:\d{2}$/)
  })
  it('is empty without a valid start', () => {
    expect(fmtEventWhen(null, null)).toBe('')
    expect(fmtEventWhen('not a date', null)).toBe('')
  })
})
