import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  indexedDBLocalPersistence,
  initializeAuth,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
} from 'firebase/auth'
import type { AppConfig } from '../config'
import type { AuthBackend, AuthUser } from './types'

export class FirebaseConfigError extends Error {}

export function createFirebaseAuth(cfg: AppConfig): AuthBackend {
  const f = cfg.firebase
  if (!f.apiKey || !f.authDomain || !f.projectId || !f.appId) {
    throw new FirebaseConfigError(
      'Firebase is not configured. Fill in the VITE_FIREBASE_* values in frontend/.env.local (see .env.example).',
    )
  }
  const app: FirebaseApp = initializeApp(f)
  // initializeAuth without a popupRedirectResolver keeps the popup/iframe code out of the
  // initial mobile bundle; it is loaded only when Google sign-in is actually used.
  const auth: Auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
  const toUser = (u: { uid: string; email: string | null; displayName: string | null } | null): AuthUser | null =>
    u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null

  return {
    kind: 'firebase',
    googleEnabled: cfg.googleSignIn,
    subscribe(cb) {
      // onIdTokenChanged also fires on token refresh / revocation.
      return onIdTokenChanged(auth, (u) => cb(toUser(u)))
    },
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email, password)
    },
    async signUp(email, password, displayName) {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (displayName.trim()) await updateProfile(cred.user, { displayName: displayName.trim() })
      await cred.user.getIdToken(true)
    },
    async signInWithGoogle() {
      if (!cfg.googleSignIn) throw new Error('Google sign-in is not enabled.')
      const { googleSignIn } = await import('./googleSignIn')
      await googleSignIn(auth)
    },
    async signOut() {
      await signOut(auth)
    },
    async getIdToken(forceRefresh) {
      const u = auth.currentUser
      return u ? u.getIdToken(forceRefresh) : null
    },
  }
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/invalid-email': 'Invalid email.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'No network connection.',
  'auth/popup-closed-by-user': 'The sign-in window was closed.',
}

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code
  if (code && MESSAGES[code]) return MESSAGES[code]
  return e instanceof Error ? e.message : 'Sign-in failed.'
}
