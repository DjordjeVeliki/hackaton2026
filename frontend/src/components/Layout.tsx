import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { hasRole, useMe } from '../api/hooks'
import { useServices } from '../services'
import { useSpeakerTranscription } from './SpeakerLive'
import { Button } from './ui'

// Only loaded in mock mode; the import is tree-shaken from production builds.
const DevBanner =
  import.meta.env.VITE_USE_MOCKS === 'true' ? lazy(() => import('../dev/DevBanner')) : () => null

interface Tab {
  to: string
  label: string
  icon: string
  end?: boolean
}

export function Layout() {
  const { auth, mocks } = useServices()
  const qc = useQueryClient()
  const me = useMe()
  const { eventId } = useParams()
  const speaker = useSpeakerTranscription()
  const roles = me.data?.roles

  const tabs: Tab[] = eventId
    ? [
        { to: `/events/${eventId}`, label: 'Predavanja', icon: '🎤', end: true },
        ...(hasRole(roles, 'speaker') ? [{ to: `/speaker/events/${eventId}`, label: 'Pitanja', icon: '💬' }] : []),
        ...(hasRole(roles, 'sponsor') ? [{ to: `/sponsor/events/${eventId}`, label: 'Sponzor', icon: '🤝' }] : []),
        ...(hasRole(roles, 'organizer') ? [{ to: `/organizer/events/${eventId}`, label: 'Organizator', icon: '📊' }] : []),
        { to: `/events/${eventId}/profile`, label: 'Profil', icon: '👤' },
      ]
    : []

  const topCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2 py-1 text-sm ${isActive ? 'bg-brand-100 text-brand-900 font-medium' : 'text-slate-700 hover:bg-slate-100'}`
  const tabCls = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
      isActive ? 'text-brand-700' : 'text-slate-500'
    }`

  return (
    <div className="min-h-dvh">
      {mocks && (
        <Suspense fallback={null}>
          <DevBanner />
        </Suspense>
      )}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2">
        Preskoči na sadržaj
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <Link to="/events" className="mr-1 text-lg font-bold text-brand-700">
            Cuevia
          </Link>
          {speaker.controller.isActive && speaker.snap.talkId && eventId && (
            <Link
              to={`/events/${eventId}/talks/${speaker.snap.talkId}`}
              className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800"
              role="status"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden />
              Uživo
            </Link>
          )}
          <nav aria-label="Glavna navigacija" className="hidden flex-1 items-center gap-1 sm:flex">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={topCls}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto hidden text-sm text-slate-600 sm:ml-0 sm:inline">{me.data?.display_name}</span>
          <Button
            className="ml-auto sm:ml-0"
            variant="ghost"
            size="sm"
            onClick={async () => {
              await speaker.controller.stop()
              await auth.signOut()
              qc.clear()
            }}
          >
            Odjava
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:pb-28">
        <Outlet />
      </main>
      {tabs.length > 0 && (
        <nav
          aria-label="Navigacija"
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        >
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={tabCls}>
              <span className="text-lg leading-none" aria-hidden>
                {t.icon}
              </span>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
