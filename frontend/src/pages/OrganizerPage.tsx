import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { qk, useTalks } from '../api/hooks'
import type { Metrics, Talk } from '../api/types'
import { Badge, Button, Card, EmptyState, ErrorAlert, inputClass, Notice, Spinner } from '../components/ui'
import { useApi, useRecorder } from '../services'

export function OrganizerPage() {
  const { eventId = '' } = useParams()
  const api = useApi()
  const qc = useQueryClient()
  const talks = useTalks(eventId)
  const metrics = useQuery({ queryKey: qk.metrics(eventId), queryFn: () => api.metrics(eventId), refetchInterval: 30_000 })
  const [confirming, setConfirming] = useState(false)
  const finalize = useMutation({
    mutationFn: () => api.finalizeShortlists(eventId),
    onSuccess: () => {
      setConfirming(false)
      void qc.invalidateQueries({ queryKey: qk.metrics(eventId) })
    },
  })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Organizer</h1>

      <Card title="Talks and official transcript source">
        <p className="mb-3 text-sm text-slate-700">
          The official source is the recording the backend uses as the authoritative transcript (e.g. for question context). It is set automatically when the speaker starts transcription; you can override it here with a recording ID.
        </p>
        {talks.isPending && <Spinner />}
        {talks.isError && <ErrorAlert error={talks.error} onRetry={() => talks.refetch()} />}
        {talks.data?.length === 0 && <EmptyState>No talks.</EmptyState>}
        <ul className="space-y-3">
          {talks.data?.map((t) => (
            <li key={t.id}>
              <TranscriptSourceRow talk={t} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Finalize recommendations">
        <p className="mb-3 text-sm text-slate-700">
          Freezes lists of up to five recommended attendees per opportunity. Sponsors then see only consenting profiles.
        </p>
        {finalize.isSuccess ? (
          <Notice tone="success">
            Lists finalized. Snapshot: <code>{finalize.data.snapshot_id}</code>
          </Notice>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Finalize now?</span>
            <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>
              {finalize.isPending ? 'Finalizing…' : 'Yes, finalize'}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={finalize.isPending}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button onClick={() => setConfirming(true)}>Finalize lists</Button>
        )}
        {finalize.isError && (
          <div className="mt-2">
            <ErrorAlert error={finalize.error} />
          </div>
        )}
      </Card>

      <Card title="Event metrics">
        {metrics.isPending && <Spinner />}
        {metrics.isError && <ErrorAlert error={metrics.error} onRetry={() => metrics.refetch()} />}
        {metrics.data && <MetricsView m={metrics.data} />}
      </Card>
    </div>
  )
}

function TranscriptSourceRow({ talk }: { talk: Talk }) {
  const api = useApi()
  const { snap } = useRecorder()
  const ownRecording = snap.talkId === talk.id ? snap.session?.recording_id : undefined
  const [rid, setRid] = useState('')
  const m = useMutation({ mutationFn: (recordingId: string) => api.setTranscriptSource(talk.id, recordingId) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (rid.trim()) m.mutate(rid.trim())
  }
  const inputId = `src-${talk.id}`
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{talk.title}</span>
        <span className="text-sm text-slate-600">{talk.speaker_name}</span>
        {m.isSuccess && <Badge tone="green">Source set</Badge>}
      </div>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor={inputId} className="sr-only">
          Recording ID for {talk.title}
        </label>
        <input
          id={inputId}
          className={`${inputClass} min-w-0 flex-1`}
          placeholder="Recording ID"
          value={rid}
          onChange={(e) => setRid(e.target.value)}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={m.isPending || !rid.trim()}>
          Set
        </Button>
        {ownRecording && (
          <Button size="sm" variant="ghost" onClick={() => m.mutate(ownRecording)} disabled={m.isPending}>
            Use my current recording
          </Button>
        )}
      </form>
      {m.isError && (
        <div className="mt-2">
          <ErrorAlert error={m.error} />
        </div>
      )}
    </div>
  )
}

function MetricsView({ m }: { m: Metrics }) {
  const tiles: [string, number][] = [
    ['Attendees', m.attendee_count],
    ['Processed CVs', m.cv_parsed_count],
    ['Without CV (N/A)', m.na_count],
    ['Questions', m.question_count],
    ['“I lost the thread”', m.catch_up_count],
    ['Shares with sponsors', m.share_count],
  ]
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-3">
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value.toLocaleString('en')}</dd>
          </div>
        ))}
      </dl>
      <CountChart title="Most requested terms" rows={m.requested_terms.map((t) => ({ label: t.term, count: t.count }))} empty="No explanations requested yet." />
      <CountChart title="Interest distribution" rows={m.interest_distribution.map((t) => ({ label: t.topic, count: t.count }))} empty="No interests yet." />
    </div>
  )
}

/** Single-series horizontal bars (one hue, no legend) with an accessible table. Plots only server numbers. */
function CountChart({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty: string }) {
  const data = [...rows].sort((a, b) => b.count - a.count).slice(0, 12)
  return (
    <figure>
      <figcaption className="mb-2 font-semibold">{title}</figcaption>
      {data.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <>
          <div style={{ height: Math.max(120, data.length * 32 + 30) }} aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fill: '#475569', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={120} tick={{ fill: '#334155', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [v as number, 'Count']} isAnimationActive={false} />
                <Bar dataKey="count" fill="#1d5fd6" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-brand-700">Show as table</summary>
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.label} className="border-b border-slate-100">
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </figure>
  )
}
