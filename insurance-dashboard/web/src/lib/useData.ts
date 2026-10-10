import { useEffect, useState } from 'react';
import type { CompanyData, DocsData, IfrsData, IfrsFact, KpiData, MarketData, PriceData, RegistryCompany } from './types';

const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

export function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${BASE}data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path) as Promise<T>;
}

export interface Loaded<T> { data: T | null; error: string | null }

function useLoad<T>(path: string | null): Loaded<T> {
  const [state, set] = useState<Loaded<T>>({ data: null, error: null });
  useEffect(() => {
    if (!path) { set({ data: null, error: null }); return; }
    let live = true;
    set({ data: null, error: null });
    load<T>(path).then((d) => live && set({ data: d, error: null }), (e: Error) => live && set({ data: null, error: e.message }));
    return () => { live = false; };
  }, [path]);
  return state;
}

export const useMarketData = () => useLoad<MarketData>('market.json');
export const useRegistry = () => useLoad<RegistryCompany[]>('companies/index.json');
export const useCompanyData = (id: string | null, enabled = true) => useLoad<CompanyData>(id && enabled ? `companies/${id}.json` : null);
export const useCompanyNotes = (id: string | null, enabled: boolean) => useLoad<Record<string, string>>(id && enabled ? `companies/${id}.notes.json` : null);
export const useCompanyDocs = (id: string | null, enabled: boolean) => useLoad<DocsData>(id && enabled ? `companies/${id}.docs.json` : null);
export const useCompanyPrice = (id: string | null, enabled: boolean) => useLoad<PriceData>(id && enabled ? `companies/${id}.price.json` : null);
export const useKpiData = () => useLoad<KpiData>('kpi.json');
export const useIfrsData = () => useLoad<IfrsData>('ifrs.json');
export const useIfrsFacts = (period: string | null) => useLoad<IfrsFact[]>(period ? `ifrs_${period}.json` : null);

import { useMemo } from 'react';
import { Market } from './market';
import { CompanyStore } from './company';

let marketInstance: { data: MarketData; m: Market } | null = null;
/** The aggregation engine over market.json (built once and shared). */
export function useMarket(): { market: Market | null; error: string | null } {
  const { data, error } = useMarketData();
  const market = useMemo(() => {
    if (!data) return null;
    if (!marketInstance || marketInstance.data !== data) marketInstance = { data, m: new Market(data) };
    return marketInstance.m;
  }, [data]);
  return { market, error };
}

export function useCompanyStore(id: string | null, enabled = true): { store: CompanyStore | null; error: string | null } {
  const { data, error } = useCompanyData(id, enabled);
  const store = useMemo(() => (data ? new CompanyStore(data) : null), [data]);
  return { store, error };
}

import { CompanyKpi } from './kpi';
import type { PriceData as Px } from './types';

/** Headline-figure engines for every company in kpi.json, with prices attached when they have loaded. */
export function useKpis(): { kpis: Map<string, CompanyKpi> | null; asof: string | null; notes: NonNullable<KpiData['notes']>; error: string | null } {
  const { data, error } = useKpiData();
  const ids = useMemo(() => (data ? Object.keys(data.companies) : []), [data]);
  const reg = useRegistry();
  const [prices, setPrices] = useState<Record<string, Px>>({});
  useEffect(() => {
    let live = true;
    // only companies that have a price file are asked for one
    ids.filter((id) => reg.data?.find((c) => c.id === id)?.has_price).forEach((id) => load<Px>(`companies/${id}.price.json`).then((p) => live && setPrices((cur) => ({ ...cur, [id]: p })), () => {}));
    return () => { live = false; };
  }, [ids, reg.data]);
  const kpis = useMemo(() => (data ? new Map(ids.map((id) => [id, new CompanyKpi(id, data.companies[id], prices[id] ?? null)])) : null), [data, ids, prices]);
  return { kpis, asof: data?.asof ?? null, notes: data?.notes ?? [], error };
}

export const useSavingsEcon = () => useLoad<import('./types').SavingsEcon>('savings_econ.json');

/** Extracted facts of one company across several reports, keyed by period. Periods that fail to load are left out. */
export function useIfrsCompany(id: string, periods: string[]): Map<string, IfrsFact[]> {
  const [all, setAll] = useState<Map<string, IfrsFact[]>>(new Map());
  const key = periods.join();
  useEffect(() => {
    let live = true;
    setAll(new Map());
    periods.forEach((p) => load<IfrsFact[]>(`ifrs_${p}.json`).then((fs) => live && setAll((cur) => new Map(cur).set(p, fs.filter((f) => f.c === id))), () => {}));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);
  return all;
}

/** Filing lists of several companies, flattened and tagged with the company id. */
export function useDocsOf(ids: string[]): (DocsData['docs'][number] & { company: string })[] {
  const [docs, setDocs] = useState<(DocsData['docs'][number] & { company: string })[]>([]);
  const key = ids.join();
  useEffect(() => {
    let live = true;
    setDocs([]);
    ids.forEach((id) => load<DocsData>(`companies/${id}.docs.json`).then((d) => live && setDocs((cur) => [...cur, ...d.docs.map((x) => ({ ...x, company: id }))]), () => {}));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return docs;
}

export interface Fund { k: string; fam: string; prod: string; track: string; name: string; mgr: string; grp: string; assets: number | null; fee: number | null; depfee: number | null;
  m1: number | null; ytd: number | null; y12: number | null; y3: number | null; y5: number | null; a3: number | null; a5: number | null; sd: number | null; sharpe: number | null;
  st: number | null; fo: number | null; fx: number | null; n: number; top: number | null; yrs: number | null; closed: boolean;
  id: number; spec: string | null; sub: string | null; target: string | null; since: string | null; ctrl: string | null; liq: number | null; cls: string | null }
export interface FundHist { p: number[]; y: (number | null)[]; a: (number | null)[]; fee: (number | null)[]; st: (number | null)[]; fo: (number | null)[]; fx: (number | null)[]; dep?: (number | null)[]; wd?: (number | null)[]; tr?: (number | null)[] }
export type FundCats = Record<string, { p: number[]; y: number[]; n: number[] }>;
export const useFunds = () => useLoad<{ asof: number; source: string; funds: Fund[] }>('funds.json');
export const useFundCats = () => useLoad<FundCats>('funds/cat.json');
export const useFundHist = (k: string | null) => useLoad<FundHist>(k ? `funds/${k}.json` : null);
