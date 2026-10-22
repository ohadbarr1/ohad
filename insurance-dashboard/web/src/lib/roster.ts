/** Roster changes behind an aggregate's change (W5-14): the arithmetic lives in rosterCore.ts, the data hook here. */
import { useLoad } from './useData';
import type { RosterFile } from './rosterCore';

export * from './rosterCore';
export const useRosterFile = (on: boolean) => useLoad<RosterFile>(on ? 'roster.json' : null);
