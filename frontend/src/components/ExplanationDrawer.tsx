import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import type { Depth, RetrievalMode } from '../api/types'
import { useApi } from '../services'
import { Badge, Button, Drawer, ErrorAlert, ExternalLink, inputClass, Spinner } from './ui'

const DEPTHS: { key: Depth; label: string }[] = [
  { key: 'simple', label: 'Simple' },
  { key: 'standard', label: 'Standard' },
  { key: 'advanced', label: 'Advanced' },
]

const MODE: Record<RetrievalMode, { text: string; tone: 'green' | 'blue' | 'amber' }> = {
  web: { text: 'With web sources', tone: 'green' },
  provided: { text: 'From event materials', tone: 'blue' },
  general: { text: 'Model’s general knowledge — no web sources', tone: 'amber' },
}

export function ExplanationDrawer({
  recordingId,
  initialTerm,
  segmentId,
  open,
  onOpenChange,
}: {
  recordingId: string | null
  initialTerm: string
  segmentId: string | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const api = useApi()
  const [term, setTerm] = useState(initialTerm)
  const [draft, setDraft] = useState(initialTerm)
  const [depth, setDepth] = useState<Depth>('standard')

  useEffect(() => {
    if (open) {
      setTerm(initialTerm)
      setDraft(initialTerm)
    }
  }, [open, initialTerm])

  const enabled = open && !!recordingId && !!segmentId && term.trim().length > 0
  const q = useQuery({
    queryKey: ['explain', recordingId, segmentId, term, depth],
    queryFn: () => api.explain(recordingId!, term.trim(), segmentId!, depth),
    enabled,
    staleTime: Infinity,
    retry: false,
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTerm(draft.trim())
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Explain a term" description="Tailored to you and to the talk’s context.">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="term-input" className="sr-only">
          Term
        </label>
        <input
          id="term-input"
          className={inputClass}
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Select or type a term"
        />
        <Button type="submit" disabled={!draft.trim()}>
          Explain
        </Button>
      </form>
      <div role="radiogroup" aria-label="Explanation depth" className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {DEPTHS.map((d) => (
          <button
            key={d.key}
            type="button"
            role="radio"
            aria-checked={depth === d.key}
            onClick={() => setDepth(d.key)}
            className={`min-h-10 rounded-md text-sm ${depth === d.key ? 'bg-white font-semibold shadow-sm' : 'text-slate-700'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {!segmentId && <p className="mt-3 text-sm text-slate-600">An explanation needs at least one transcript line as context.</p>}
      <div className="mt-4" aria-live="polite">
        {q.isFetching && <Spinner label="Preparing the explanation…" />}
        {q.isError && <ErrorAlert error={q.error} onRetry={() => q.refetch()} />}
        {q.data && !q.isFetching && (
          <article className="space-y-3">
            <Badge tone={MODE[q.data.retrieval_mode].tone}>{MODE[q.data.retrieval_mode].text}</Badge>
            <h3 className="text-lg font-semibold">{term}</h3>
            <p className="leading-relaxed whitespace-pre-wrap">{q.data.explanation}</p>
            {q.data.example && (
              <div className="rounded-lg bg-slate-50 p-3">
                <h4 className="text-sm font-medium text-slate-700">Example</h4>
                <p className="whitespace-pre-wrap">{q.data.example}</p>
              </div>
            )}
            {q.data.sources.length > 0 ? (
              <div>
                <h4 className="text-sm font-medium">Sources</h4>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {q.data.sources.map((s) => (
                    <li key={s.id}>
                      <ExternalLink href={s.url}>{s.title || s.url}</ExternalLink>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No sources for this explanation. Verify key claims yourself.</p>
            )}
          </article>
        )}
      </div>
    </Drawer>
  )
}
