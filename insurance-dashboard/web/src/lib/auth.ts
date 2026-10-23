/* Who the reader is, and the sync that follows from it. Small and SDK-free: the Firebase code (lib/firebase) is imported only when
   the reader taps "התחבר", or after the first paint for a reader who signed in on this device before. With SYNC_ENABLED off this
   module only reports "off". */
import { useEffect, useState } from 'react';
import { EVENT, PREFIX } from './local';
import { browserStore, deviceId, runInPage, SyncEngine, type SyncStatus } from './sync';
import { LOCAL_ONLY, SYNC_ENABLED } from './syncConfig';

export interface AuthState {
  state: 'off' | 'out' | 'loading' | 'in' | 'error';
  name?: string;
  email?: string;
  sync?: SyncStatus;
  error?: string;
}

let cur: AuthState = { state: SYNC_ENABLED ? 'out' : 'off' };
const subs = new Set<(s: AuthState) => void>();
const put = (s: Partial<AuthState>) => { cur = { ...cur, ...s }; subs.forEach((f) => f(cur)); };

const skip = (k: string) => LOCAL_ONLY.has(k) || k.startsWith('foxsync');
let engine: SyncEngine | null = null;
let stopPage: (() => void) | null = null;
let watching: Promise<void> | null = null;
let signingIn = false;

const mark = (on: boolean) => { try { if (on) localStorage.setItem('foxsync:on', '1'); else localStorage.removeItem('foxsync:on'); } catch { /* blocked */ } };

function watch(): Promise<void> {
  if (!watching) watching = (async () => {
    const fb = await import('./firebase');
    await fb.watchUser(async (u) => {
      stopPage?.(); stopPage = null;
      if (!u) { engine = null; mark(false); if (signingIn) return; put({ state: 'out', name: undefined, email: undefined, sync: undefined }); return; }
      mark(true);
      put({ state: 'in', name: u.name, email: u.email });
      engine = new SyncEngine(browserStore(PREFIX, EVENT, skip), await fb.firestoreAdapter(u.uid), deviceId());
      engine.onStatus((s) => put({ sync: s }));
      stopPage = runInPage(engine, EVENT, skip);
    });
  })().catch((e) => { watching = null; put({ state: 'error', error: msg(e) }); });
  return watching;
}

const msg = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/unauthorized-domain') return 'הדומיין לא מורשה להתחברות';
  if (code === 'auth/network-request-failed' || String(e).includes('init.json')) return 'אין חיבור לשירות ההתחברות';
  return 'ההתחברות נכשלה';
};

/** called after the first paint when this device signed in before */
export async function resume(): Promise<void> { if (SYNC_ENABLED) await watch(); }

export async function signIn(): Promise<void> {
  if (!SYNC_ENABLED) return;
  put({ state: 'loading', error: undefined });
  signingIn = true;
  try {
    await watch();
    const fb = await import('./firebase');
    await fb.signIn();
  } catch (e) { const m = msg(e); put(m ? { state: 'error', error: m } : { state: 'out' }); }
  finally { signingIn = false; }
}

export async function signOut(): Promise<void> {
  if (!SYNC_ENABLED) return;
  await engine?.flush().catch(() => undefined);
  engine?.reset();
  const fb = await import('./firebase');
  await fb.signOut();
}

/** sync now (the button on "שלי") */
export const syncNow = () => engine?.sync();

export function useAuth(): AuthState {
  const [s, set] = useState(cur);
  useEffect(() => { subs.add(set); set(cur); return () => { subs.delete(set); }; }, []);
  return s;
}
