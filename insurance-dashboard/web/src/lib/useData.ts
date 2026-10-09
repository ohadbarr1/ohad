import { useEffect, useState } from 'react';
import type { CompanyData, DocsData, KpiData, MarketData, PriceData, RegistryCompany } from './types';

const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

function load<T>(path: string): Promise<T> {
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
  const [prices, setPrices] = useState<Record<string, Px>>({});
  useEffect(() => {
    let live = true;
    ids.forEach((id) => load<Px>(`companies/${id}.price.json`).then((p) => live && setPrices((cur) => ({ ...cur, [id]: p })), () => {}));
    return () => { live = false; };
  }, [ids]);
  const kpis = useMemo(() => (data ? new Map(ids.map((id) => [id, new CompanyKpi(id, data.companies[id], prices[id] ?? null)])) : null), [data, ids, prices]);
  return { kpis, asof: data?.asof ?? null, notes: data?.notes ?? [], error };
}
