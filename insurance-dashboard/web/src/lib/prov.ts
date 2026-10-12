import { createContext, useContext } from 'react';
import type { Market, MetricKey, Win } from './market';
import { ckanQuery, resourceOf, type RegDs, type RegResource } from './sources';

/** Where a number on the screen comes from. One shape per kind of source; the source sheet renders each. */
export type Prov =
  /** an aggregate of the regulator's fund files: rebuilt from its tracks when the sheet opens */
  | { k: 'reg'; metric: MetricKey; pi: number; w: Win; set: string; g: number }
  /** a figure printed in a filed report */
  | { k: 'report'; title: string; value: string; unit?: string; url: string | null; pg: number | null; doc?: string; period?: string; note?: string; srcType?: string;
      der?: boolean; old?: boolean; turned?: boolean; restated?: { first: string; last: string; firstHref?: string; lastHref?: string; in: string } }
  /** a tagged figure of the electronic filing */
  | { k: 'xbrl'; title: string; value: string; unit?: string; company: string; period: string; rid: number | null; concept: string; status?: string; note?: string }
  /** computed on the site from other sourced figures */
  | { k: 'calc'; title: string; value: string; unit?: string; formula: string; inputs: { label: string; v: string; src?: () => Prov }[]; est?: boolean; note?: string }
  /** one track of the regulator's files, as published */
  | { k: 'fund'; title: string; value: string; unit?: string; ds: RegDs; id: number; period: number; col: string; note?: string }
  | { k: 'price'; title: string; value: string; ticker: string; vendor: string; date: string }
  | { k: 'none'; title: string; why: string };

export interface SourceApi { open: (p: Prov) => void }
export const SourceCtx = createContext<SourceApi>({ open: () => {} });
export const useSource = () => useContext(SourceCtx);

/** A regulator figure is fully described by its key, so its sheet survives a reload and can be linked. */
export const regKey = (p: Extract<Prov, { k: 'reg' }>, m: Market) => ['reg', p.metric, m.P[p.pi], p.w, p.set, p.g < 0 ? '' : m.d.groups[p.g]].join('~');
export function parseRegKey(key: string, m: Market): Prov | null {
  const [k, metric, period, w, set, group] = key.split('~');
  const pi = m.P.indexOf(Number(period)), g = group ? m.d.groups.indexOf(group) : -1;
  if (k !== 'reg' || pi < 0 || (group && g < 0) || !m.sets.some((s) => s.id === set)) return null;
  return { k: 'reg', metric: metric as MetricKey, pi, w: w as Win, set, g };
}

/* ---------- the tracks behind an aggregate ---------- */
interface RegFile { group: string; months: number[]; funds: [RegDs, number, string, number, string][]; a: (number | null)[][]; fee: (number | null)[][]; y: (number | null)[][]; prev: (number | null)[][]; dep: (number | null)[][]; wd: (number | null)[][]; tr: (number | null)[][] }
export interface Track { ds: RegDs; id: number; name: string; prod: string; mgr: string; group: string;
  /** one entry per month of the window, oldest first */
  a: (number | null)[]; fee: (number | null)[]; y: (number | null)[]; prev: (number | null)[]; dep: (number | null)[]; wd: (number | null)[]; tr: (number | null)[] }

const cache = new Map<string, Promise<RegFile | null>>();
const file = (g: number, year: number) => {
  const k = `${g}/${year}`;
  if (!cache.has(k)) cache.set(k, fetch(`${import.meta.env.BASE_URL}data/prov/reg/${k}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(k)!;
};

/** Every track of the selection, with its monthly figures over `periods` (yyyymm, ascending). g = -1 loads the whole market. */
export async function loadTracks(m: Market, g: number, set: string, periods: number[]): Promise<Track[]> {
  const has = m.sets.find((s) => s.id === set)!.has, groups = g < 0 ? m.d.groups.map((_, i) => i) : [g];
  const years = [...new Set(periods.map((p) => Math.floor(p / 100)))];
  const files = await Promise.all(groups.flatMap((gi) => years.map((y) => file(gi, y).then((f) => ({ f, y })))));
  const by = new Map<string, Track>();
  const blank = () => periods.map(() => null as number | null);
  for (const { f } of files) {
    if (!f) continue;
    f.funds.forEach((fu, i) => {
      if (!has.has(fu[3])) return;
      periods.forEach((p, k) => {
        const mi = f.months.indexOf(p);
        if (mi < 0 || f.a[i][mi] == null) return;
        const key = `${fu[0]}|${fu[1]}`;
        let t = by.get(key);
        if (!t) { t = { ds: fu[0], id: fu[1], name: fu[2], prod: m.d.products[fu[3]].label, mgr: fu[4], group: f.group, a: blank(), fee: blank(), y: blank(), prev: blank(), dep: blank(), wd: blank(), tr: blank() }; by.set(key, t); }
        (['a', 'fee', 'y', 'prev', 'dep', 'wd', 'tr'] as const).forEach((c) => { t![c][k] = f[c][i][mi]; });
      });
    });
  }
  return [...by.values()];
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0);
/** The same arithmetic as the aggregates, run over the tracks: what the sheet shows must equal what the page shows. */
export function recompute(metric: MetricKey, ts: Track[], n: number, base?: Track[]): number | null {
  const last = n - 1;
  const assets = (k: number) => ts.reduce((s, t) => s + (t.a[k] ?? 0), 0);
  switch (metric) {
    case 'assets': return assets(last) / 1000;
    case 'organic': return ts.reduce((s, t) => s + sum(t.dep) - sum(t.wd), 0) / 1000;
    case 'transfers': return ts.reduce((s, t) => s + sum(t.tr), 0) / 1000;
    case 'netflow': return ts.reduce((s, t) => s + sum(t.dep) - sum(t.wd) + sum(t.tr), 0) / 1000;
    case 'fee': { let num = 0, den = 0; for (const t of ts) if (t.fee[last] != null && t.a[last] != null) { num += t.a[last]! * t.fee[last]!; den += t.a[last]!; } return den > 0 ? num / den : null; }
    case 'ret': { let f = 1; for (let k = 0; k < n; k++) { let num = 0, den = 0; for (const t of ts) if (t.y[k] != null && t.prev[k] != null && t.prev[k]! > 0) { num += t.prev[k]! * t.y[k]!; den += t.prev[k]!; } if (!(den > 0)) return null; f *= 1 + num / den / 100; } return (f - 1) * 100; }
    case 'share': { const all = base ? base.reduce((s, t) => s + (t.a[last] ?? 0), 0) : 0; return all > 0 ? assets(last) / all * 100 : null; }
    default: return null;
  }
}

/* ---------- live check against the regulator's open data ---------- */
export interface LiveResult { checked: number; equal: number; missing: number; worst: { name: string; ours: number; theirs: number | null } | null; at: string }
const COL = { a: 'TOTAL_ASSETS', fee: 'AVG_ANNUAL_MANAGEMENT_FEE', y: 'MONTHLY_YIELD', dep: 'DEPOSITS', wd: 'WITHDRAWLS', tr: 'INTERNAL_TRANSFERS' } as const;
export type RegCol = keyof typeof COL;

/** Fetches the same months from data.gov.il and compares track by track. Runs in the reader's browser, against the source itself. */
export async function liveCheck(resources: Record<string, RegResource[]>, ts: Track[], periods: number[], cols: RegCol[]): Promise<LiveResult> {
  const out: LiveResult = { checked: 0, equal: 0, missing: 0, worst: null, at: new Date().toISOString().slice(0, 10) };
  const dss = [...new Set(ts.map((t) => t.ds))];
  await Promise.all(dss.flatMap((ds) => periods.map(async (p, k) => {
    const res = resourceOf(resources[ds], p);
    if (!res) throw new Error(`אין קובץ מקור ל-${ds} ${p}`);
    const r = await fetch(ckanQuery(res.id, { REPORT_PERIOD: p }, ['FUND_ID', ...cols.map((c) => COL[c])]));
    if (!r.ok) throw new Error(`data.gov.il ${r.status}`);
    const rows = (await r.json()).result.records as Record<string, unknown>[];
    const by = new Map(rows.map((x) => [Number(x.FUND_ID), x]));
    for (const t of ts) {
      if (t.ds !== ds || t.a[k] == null) continue;
      const src = by.get(t.id);
      for (const c of cols) {
        const ours = t[c][k];
        if (ours == null) continue;
        out.checked++;
        const raw = src?.[COL[c]], theirs = raw == null || raw === '' ? null : Number(raw);
        if (theirs == null) { out.missing++; out.worst ??= { name: t.name, ours, theirs }; continue; }
        if (Math.abs(theirs - ours) <= 0.00051 + Math.abs(ours) * 1e-9) out.equal++;
        else if (!out.worst || out.worst.theirs == null || Math.abs(theirs - ours) > Math.abs(out.worst.theirs - out.worst.ours)) out.worst = { name: t.name, ours, theirs };
      }
    }
  })));
  return out;
}

/** For pages that mirror their state in the address: writes their own parameters and keeps an open source sheet open. */
export const keepSrc = (own: Record<string, string>) => (prev: URLSearchParams): Record<string, string> => { const s = prev.get('src'); return s ? { ...own, src: s } : own; };
