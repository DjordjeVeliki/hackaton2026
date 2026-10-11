import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { qk } from '../api/hooks'
import type { CvStatus, ProfilePublic } from '../api/types'
import { useApi } from '../services'
import { Badge, Button, ErrorAlert, Notice } from './ui'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

export const CV_LABEL: Record<CvStatus, { text: string; tone: 'slate' | 'amber' | 'green' | 'red' }> = {
  missing: { text: 'No CV uploaded', tone: 'slate' },
  uploaded: { text: 'CV uploaded', tone: 'amber' },
  processing: { text: 'Processing CV…', tone: 'amber' },
  parsed: { text: 'CV processed', tone: 'green' },
  failed: { text: 'CV processing failed', tone: 'red' },
  removed: { text: 'CV removed', tone: 'slate' },
}

/** CV status + eligibility. Deliberately no numeric expertise, rating or rank. */
export function ProfileStatus({ profile }: { profile: ProfilePublic }) {
  const cv = CV_LABEL[profile.cv_status]
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-slate-600">CV</dt>
        <dd>
          <Badge tone={cv.tone}>{cv.text}</Badge>
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">Expertise</dt>
        <dd>
          {profile.expertise_status === 'N/A' ? (
            <Badge>N/A — no processed CV</Badge>
          ) : (
            <Badge tone="blue">Estimated (advisory)</Badge>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">Sponsor recommendations</dt>
        <dd>
          {profile.eligible_for_top5 ? (
            <Badge tone="green">You can be recommended (with your consent)</Badge>
          ) : (
            <Badge>Not eligible for recommendations</Badge>
          )}
        </dd>
      </div>
    </dl>
  )
}

export function CvPanel({ eventId, profile }: { eventId: string; profile: ProfilePublic }) {
  const api = useApi()
  const qc = useQueryClient()
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadCv(eventId, file),
    onSuccess: (r) => {
      qc.setQueryData<ProfilePublic>(qk.profile(eventId), (p) => (p ? { ...p, cv_status: r.cv_status } : p))
      void qc.invalidateQueries({ queryKey: qk.profile(eventId) })
      if (fileRef.current) fileRef.current.value = ''
    },
  })
  const remove = useMutation({
    mutationFn: () => api.removeCv(eventId),
    onSuccess: (p) => qc.setQueryData(qk.profile(eventId), p),
  })

  const onFile = (file: File | undefined) => {
    setLocalError(null)
    if (!file) return
    if (file.size > MAX_BYTES) return setLocalError('The file is larger than 10 MB.')
    upload.mutate(file)
  }

  const s = profile.cv_status
  const busy = s === 'uploaded' || s === 'processing' || upload.isPending
  const hasCv = s === 'uploaded' || s === 'processing' || s === 'parsed' || s === 'failed'

  return (
    <div className="space-y-3">
      <ProfileStatus profile={profile} />
      {busy && (
        <p role="status" className="text-sm text-slate-700">
          {upload.isPending ? 'Uploading…' : 'Your CV is being processed. You can keep using the app.'}
        </p>
      )}
      {s === 'failed' && (
        <Notice tone="warn">
          We couldn’t process this CV. Expertise stays N/A and you are not eligible for recommendations, but all talk features still work. Try another file (PDF, DOCX or TXT).
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
          disabled={busy}
        />
        <label
          htmlFor={inputId}
          className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg px-4 font-medium focus-within:outline ${busy ? 'cursor-not-allowed bg-slate-300 text-slate-600' : 'bg-brand-600 text-white hover:bg-brand-700'}`}
          tabIndex={busy ? -1 : 0}
          onKeyDown={(e) => {
            if (!busy && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
          role="button"
          aria-disabled={busy}
        >
          {hasCv ? 'Upload a new CV' : 'Upload CV'}
        </label>
        {hasCv && (
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending || upload.isPending}>
            {remove.isPending ? 'Removing…' : 'Remove CV'}
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-600">
        PDF, DOCX or TXT, up to 10 MB. The CV-based estimate is advisory; it is not a knowledge test or a hiring decision. Sponsors see your CV only if you explicitly allow it.
      </p>
      {localError && (
        <p role="alert" className="text-sm text-red-700">
          {localError}
        </p>
      )}
      {upload.isError && <ErrorAlert error={upload.error} />}
      {remove.isError && <ErrorAlert error={remove.error} />}
    </div>
  )
}
