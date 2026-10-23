/* Notes anchored to a fact: (company, period, metric). One stored key per note (`note.<co>|<period>|<metric>`), so two devices that
   annotate different figures never overwrite each other when sync is on. The metric part is the surface's own stable id: the line's
   cross-company role in the statements when it has one, else the line or ledger label; the period is the screen label (Q2'26, FY'25). */
import { useCallback, useMemo } from 'react';
import { readStored, storedKeys, useStored, useStoreTick, writeStored } from './local';
import { SYNC_ENABLED } from './syncConfig';

export interface FactNote {
  /** the text */
  t: string;
  co: string;
  p: string;
  m: string;
  /** what the figure is called where the note was written */
  l?: string;
  /** where the note was written (path + query), to open the figure again */
  href?: string;
  /** last edit, ms */
  at: number;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
export const NOTE_PREFIX = 'note.';
export const factKey = (co: string, p: string, m: string) => `${clean(co)}|${clean(p)}|${clean(m)}`;

/** the note on one figure, and a setter (an empty text removes it) */
export function useNote(key: string | null): [FactNote | null, (text: string, meta?: { l?: string; href?: string }) => void] {
  const [note] = useStored<FactNote | null>(key ? NOTE_PREFIX + key : '__none', null);
  const set = useCallback((text: string, meta?: { l?: string; href?: string }) => {
    if (!key) return;
    const t = text.replace(/\s+$/, '');
    if (!t.trim()) { writeStored(NOTE_PREFIX + key, undefined); return; }
    const [co, p, m] = key.split('|');
    const prev = readStored<FactNote | null>(NOTE_PREFIX + key, null);
    writeStored(NOTE_PREFIX + key, { t, co, p, m, l: meta?.l ?? prev?.l, href: meta?.href ?? prev?.href, at: Date.now() } satisfies FactNote);
  }, [key]);
  return [key ? note : null, set];
}

/** every anchored note (of one company), newest first */
export function useFactNotes(co?: string): (FactNote & { key: string })[] {
  const tick = useStoreTick(NOTE_PREFIX);
  return useMemo(() => storedKeys(NOTE_PREFIX)
    .map((k) => ({ ...readStored<FactNote | null>(k, null), key: k.slice(NOTE_PREFIX.length) }))
    .filter((n): n is FactNote & { key: string } => typeof n.t === 'string' && !!n.t && (!co || n.co === co))
    .sort((a, b) => b.at - a.at),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tick, co]);
}

export const removeNote = (key: string) => writeStored(NOTE_PREFIX + key, undefined);

/** where a note is kept, in the words of a note's footer */
export function savedWhere(): string {
  let on = false;
  try { on = SYNC_ENABLED && localStorage.getItem('foxsync:on') === '1'; } catch { /* blocked */ }
  return on ? 'נשמר ומסונכרן' : 'נשמר במכשיר הזה';
}

/** a statement line's metric id for a note: its cross-company role when it has one, else sheet + label (+ dimension) */
export const lineKey = (m: { role?: string; sheet: string; label: string; dim?: string }) => m.role ?? [m.sheet, m.label, m.dim].filter(Boolean).join(':');
