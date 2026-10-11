import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { authErrorMessage } from '../auth/firebase'
import { Button, Card, Field, inputClass, Notice, Spinner } from '../components/ui'
import { useAuthState, useServices } from '../services'

export function LoginPage() {
  const { auth, mocks } = useServices()
  const state = useAuthState()
  const loc = useLocation() as { state?: { from?: string; expired?: boolean } }
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'loading') return <Spinner />
  if (state.status === 'signedIn') return <Navigate to={loc.state?.from ?? '/events'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await auth.signIn(email, password)
      else await auth.signUp(email, password, name)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="text-3xl font-bold text-brand-700">Cuevia</h1>
        <p className="text-slate-700">Follow the talk, catch up on what you missed, ask the speaker a question.</p>
      </div>
      {mocks && <Notice tone="warn">Development mode: synthetic sign-in, no account is real.</Notice>}
      {loc.state?.expired && <Notice tone="warn">Your session expired. Please sign in again.</Notice>}
      <Card>
        <div role="tablist" aria-label="Access mode" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-10 rounded-md text-sm font-medium ${mode === m ? 'bg-white shadow-sm' : 'text-slate-700'}`}
            >
              {m === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <Field label="Full name" htmlFor="name">
              <input id="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password" hint={mode === 'register' ? 'At least 6 characters.' : undefined}>
            <input
              id="password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        {auth.googleEnabled && (
          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={busy}
            onClick={async () => {
              setError(null)
              try {
                await auth.signInWithGoogle()
              } catch (err) {
                setError(authErrorMessage(err))
              }
            }}
          >
            Continue with Google
          </Button>
        )}
      </Card>
      <p className="text-xs text-slate-600">
        After signing up you can (but don’t have to) upload a CV. All talk features work without it.
      </p>
    </main>
  )
}
