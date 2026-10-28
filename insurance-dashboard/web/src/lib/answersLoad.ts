/** S1 / S2 / S6 on the page: the files, their sources, the exhibit as a chart-book spec. The pure library is lib/answers.ts. */
import { useEffect, useMemo, useState } from 'react';
import { load, useLoad } from './useData';
import { ltsProv } from './lens';
import { refsOf, uniqRefs, type SrcRef } from './exportProv';
import { fprov, warmProv } from './fragilityLoad';
import type { ChartSpec } from './book';
import type { ProvJ } from './fragility';
import { figIds, type Answer, type Cite, type Exhibit, type FindingsFile, type IndexFile, type LtsCite, type OkBody, type TopicFile } from './answers';

export const FINDINGS = 'findings.json';
export const useAnswerIndex = (enabled = true) => useLoad<IndexFile>(enabled ? 'answers/index.json' : null);

/** the answered bodies of the topics asked for, by question id (null until the first file arrives); a topic file that fails is skipped */
export function useBodies(topics: string[] | null): Map<string, Answer> | null {
  const key = topics?.slice().sort().join(',') ?? '';
  const [m, set] = useState<Map<string, Answer> | null>(null);
  useEffect(() => {
    if (!topics) return;
    let live = true;
    void Promise.all(topics.map((t) => load<TopicFile>(`answers/${t}.json`).catch(() => null))).then((fs) => {
      if (!live) return;
      const out = new Map<string, Answer>();
      fs.forEach((f) => f?.rows.forEach((a) => out.set(a.id, a)));
      set(out);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return m;
}

/** findings.json, or nothing: a build without the Finding Engine shows no section and no error */
export function useFindings(enabled = true): { data: FindingsFile | null; done: boolean } {
  const [st, set] = useState<{ data: FindingsFile | null; done: boolean }>({ data: null, done: false });
  useEffect(() => {
    if (!enabled) return;
    if (!__HAS_FINDINGS__) { set({ data: null, done: true }); return; }
    let live = true;
    load<FindingsFile>(FINDINGS).then((d) => live && set({ data: d && Array.isArray(d.rows) ? d : null, done: true }), () => live && set({ data: null, done: true }));
    return () => { live = false; };
  }, [enabled]);
  return st;
}

/** a figure's provenance as the source sheet opens it (lts nodes through the Savings Lens resolver) */
export const aprov = fprov;
/** loads the printed-components files an answer cites, so its sheets and its email source line are complete */
export const warmBody = (b: OkBody) => warmProv(b.figs);

/** the printed documents behind an `lts` node, once its components file has loaded (else null: the pure fallback names the company) */
export const ltsCite: LtsCite = (j) => {
  const p = ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
  if (p.k === 'none') return null;
  const refs = refsOf(p).filter((r) => r.kind === 'report' && (r.file || r.doc));
  if (!refs.length) return null;
  return refs.map((r): Cite => ({ key: `r|${r.file ?? r.doc}`, doc: r.doc ?? r.label, pages: r.page ? [r.page] : [], url: r.file }));
};

/** the source references of the figures an exhibit plots (all the answer's figures: the exhibit is drawn from the same inputs) */
export function exhibitRefs(b: OkBody): SrcRef[] {
  const ids = Object.keys(b.figs);
  const refs = ids.flatMap((id) => { try { return refsOf(fprov(b.figs[id].prov as ProvJ)); } catch { return []; } });
  return uniqRefs(refs).slice(0, 120);
}

/** the exhibit as a chart-book spec: a line exhibit is a category chart with line series; a table keeps its rows (deck only) */
export function exhibitSpec(ex: Exhibit, b: OkBody, key: string, route: string, dataDate?: string): ChartSpec & { table?: (string | number | null)[][]; foot?: string[] } {
  const now = new Date().toISOString();
  const credit = ex.credit;
  const sources = [...exhibitRefs(b), ...(credit ? [{ kind: 'text' as const, label: credit }] : [])];
  return {
    v: 1, id: Math.random().toString(36).slice(2, 10), key, title: ex.title, label: ex.title, route, params: {},
    kind: ex.kind === 'hbar' ? 'hbar' : 'cat', cats: ex.cats ?? [], unit: ex.unit ?? '', span: ex.span,
    series: (ex.series ?? []).map((s) => ({ name: s.name, type: s.type === 'line' || ex.kind === 'line' ? 'line' : 'bar', data: s.data, id: s.id })),
    sources, credit, dataDate, added: now, updated: now,
    ...(ex.kind === 'table' && ex.rows ? { table: ex.rows } : {}), foot: ex.foot,
  };
}

/** company id → Hebrew name, for the source line of xbrl and lts nodes */
export function useNames(): Record<string, string> {
  const reg = useLoad<{ id: string; name_he: string }[]>('companies/index.json');
  return useMemo(() => Object.fromEntries((reg.data ?? []).map((c) => [c.id, c.name_he])), [reg.data]);
}
export { figIds };
