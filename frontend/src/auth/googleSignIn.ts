import { browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, type Auth } from 'firebase/auth'

/** Loaded on demand: popup/iframe support is not needed for e-mail sign-in on phones. */
export async function googleSignIn(auth: Auth): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver)
}
