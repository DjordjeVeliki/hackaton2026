/** Recording-relative milliseconds → "m:ss" (or "h:mm:ss"). */
export function fmtMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** RFC3339 → local "HH:mm". */
export function fmtClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Event date/time in the viewer's time zone: "Sun, 11 Oct 2026 · 09:00–18:00" (or a range across days). */
export function fmtEventWhen(startsAt: string | null, endsAt: string | null): string {
  const s = startsAt ? new Date(startsAt) : null
  if (!s || Number.isNaN(s.getTime())) return ''
  const e = endsAt ? new Date(endsAt) : null
  if (!e || Number.isNaN(e.getTime())) return `${DAY.format(s)} · ${TIME.format(s)}`
  if (DAY.format(s) === DAY.format(e)) return `${DAY.format(s)} · ${TIME.format(s)}–${TIME.format(e)}`
  return `${DAY.format(s)} ${TIME.format(s)} – ${DAY.format(e)} ${TIME.format(e)}`
}

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
