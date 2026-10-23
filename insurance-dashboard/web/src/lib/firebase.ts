/* The only file that imports the Firebase SDK. Loaded by lib/auth when the reader taps "התחבר" (or, for a reader who signed in
   before, after the first paint) — never by the shell. Auth: Google, popup with a redirect fallback; Firestore: the lite build
   (plain HTTPS requests, no streaming channel), one document per stored key under users/{uid}/kv. */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { browserPopupRedirectResolver, getRedirectResult, GoogleAuthProvider, indexedDBLocalPersistence, browserLocalPersistence, initializeAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as fbSignOut, type Auth, type User } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, setDoc, type Firestore } from 'firebase/firestore/lite';
import { FIREBASE_CONFIG, HOSTED } from './syncConfig';
import type { Entries, SyncAdapter } from './sync';

let ready: Promise<{ app: FirebaseApp; auth: Auth; db: Firestore }> | null = null;

async function config() {
  if (FIREBASE_CONFIG) return { ...FIREBASE_CONFIG };
  const r = await fetch('/__/firebase/init.json');
  if (!r.ok) throw new Error('init.json');
  return (await r.json()) as { apiKey: string; authDomain: string; projectId: string; appId?: string };
}

function boot() {
  if (!ready) ready = (async () => {
    const c = await config();
    // on the site's own hosts the sign-in helper runs on the same host: no third-party storage, works in Safari
    if (HOSTED.includes(location.hostname)) c.authDomain = location.host;
    const app = initializeApp(c);
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
    auth.languageCode = 'he';
    return { app, auth, db: getFirestore(app) };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

export interface Who { uid: string; name: string; email: string }
const who = (u: User): Who => ({ uid: u.uid, name: u.displayName ?? u.email ?? '', email: u.email ?? '' });

/** the signed-in reader as it changes (null: signed out); the first call resolves a pending redirect sign-in */
export async function watchUser(cb: (u: Who | null) => void): Promise<() => void> {
  const { auth } = await boot();
  await getRedirectResult(auth).catch(() => null);
  return onAuthStateChanged(auth, (u) => cb(u ? who(u) : null));
}

export async function signIn(): Promise<void> {
  const { auth } = await boot();
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, p); }
  catch (e) {
    const code = (e as { code?: string }).code ?? '';
    // a blocked popup (some phone browsers): the same sign-in as a full-page redirect
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') { await signInWithRedirect(auth, p); return; }
    throw e;
  }
}

export async function signOut(): Promise<void> { const { auth } = await boot(); await fbSignOut(auth); }

const enc = (k: string) => encodeURIComponent(k).replace(/\./g, '%2E');
const dec = (id: string) => decodeURIComponent(id);

/** the reader's documents as the sync engine's remote store; the rules refuse an older stamp, which comes back as "refused" */
export async function firestoreAdapter(uid: string): Promise<SyncAdapter> {
  const { db } = await boot();
  const col = collection(db, 'users', uid, 'kv');
  return {
    async pull() {
      const snap = await getDocs(col);
      const out: Entries = {};
      snap.forEach((d) => { const x = d.data() as { v?: unknown; t?: unknown; d?: unknown }; if (typeof x.t === 'number' && typeof x.d === 'string') out[dec(d.id)] = { v: typeof x.v === 'string' ? x.v : null, t: x.t, d: x.d }; });
      return out;
    },
    async push(entries) {
      const ks = Object.keys(entries);
      const res = await Promise.allSettled(ks.map((k) => setDoc(doc(col, enc(k)), entries[k])));
      const refused: string[] = [];
      let offline: unknown = null;
      res.forEach((r, i) => { if (r.status === 'rejected') { if ((r.reason as { code?: string })?.code === 'permission-denied') refused.push(ks[i]); else offline = r.reason; } });
      if (offline) throw offline;
      return refused;
    },
  };
}
