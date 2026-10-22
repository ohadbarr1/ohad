import { useCallback } from 'react';
import type { ECharts } from 'echarts/core';
import { useStored } from './local';
import { collect, refsOf, uniqRefs, type SrcRef } from './exportProv';
import { GROUP_ID, hasIdentity } from './identity';
import { load } from './useData';
import { repName } from '../pages/companyProv';
import { loadCorpus, ridOf, DOC_TYPE_HE } from './search';

/* The chart book: an ordered list of chart specs kept in this browser. A spec is data, not a picture: the plotted series with their
   identity, unit and period span, the route that drew them, and the source of every point. The book page re-renders each spec as a
   live chart; the deck and the workbook are built from the same specs. */

export type BookKind = 'cat' | 'hbar' | 'pie' | 'scatter';
export interface BookSeries {
  name: string;
  type: 'bar' | 'line' | 'area' | 'scatter' | 'pie';
  data: (number | null)[];
  /** scatter points: x, y and the point's name */
  xy?: [number, number, string?][];
  /** identity id of the company the series stands for (fixed colour) */
  id?: string;
  /** colour on screen when captured (hex), used when the series has no identity */
  color?: string;
  /** per-point colours (hex) where the chart colours points one by one (a bar per company) */
  pointColors?: (string | null)[];
  stack?: string;
  /** second value axis (rates beside amounts) */
  axis?: 0 | 1;
  /** an invisible spacer (waterfall base) */
  hidden?: boolean;
  dashed?: boolean;
}
export interface ChartSpec {
  v: 1;
  id: string;
  /** route + label: the same chart added twice is the same entry */
  key: string;
  /** the takeaway title, editable; starts as the chart's own label */
  title: string;
  label: string;
  note?: string;
  /** pathname + query of the page that drew it (the source sheet's `src` dropped) */
  route: string;
  params: Record<string, string>;
  kind: BookKind;
  cats: string[];
  series: BookSeries[];
  unit: string;
  unit2?: string;
  /** the value axis starts here instead of zero (a waterfall next to a large balance) */
  vmin?: number;
  /** scatter axes */
  xName?: string;
  yName?: string;
  /** "Q1'21–Q2'26" when the categories are periods */
  span?: string;
  sources: SrcRef[];
  /** the chart's own source credit ("בנק ישראל, ZCM") */
  credit?: string;
  /** build date of the site's data when captured (qa.json) */
  dataDate?: string;
  added: string;
  updated: string;
}
export interface Book { v: 1; title: string; items: ChartSpec[] }
const EMPTY: Book = { v: 1, title: 'ספר הגרפים', items: [] };

/* ---------- capture ---------- */
type Loose = Record<string, unknown>;
const arr = (v: unknown): Loose[] => (Array.isArray(v) ? (v as Loose[]) : v && typeof v === 'object' ? [v as Loose] : []);
const num = (v: unknown): number | null => {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) return num((v as Loose).value);
  if (Array.isArray(v)) return num(v[v.length - 1]);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && v !== '-' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
let probe: CanvasRenderingContext2D | null = null;
/** any CSS colour as #RRGGBB (null for transparent or non-colours: gradients, patterns) */
export function hex(c: unknown): string | null {
  if (typeof c !== 'string' || !c || c === 'none' || c === 'transparent') return null;
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = c; probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (a < 8) return null;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
const invisible = (s: Loose): boolean => {
  const it = (s.itemStyle ?? {}) as Loose;
  return it.opacity === 0 || it.color === 'transparent' || it.color === 'none' || (typeof it.color === 'string' && /rgba?\([^)]*,\s*0(\.0+)?\)$/.test(it.color));
};

/** company id behind a series or category name: "הראל", "מנורה מבטחים", "ביטוח ישיר" */
const NAMES: Record<string, string> = { ...GROUP_ID, 'מנורה': 'menora', 'אלטשולר': 'altshuler', 'ילין': 'yelin', 'ישיר': 'idi', 'מור גמל ופנסיה': 'more_gemel', 'אי.בי.אי': 'ibi' };
let regNames: Record<string, string> = {}, regIds: Record<string, string> = {};
void load<{ id: string; name_he: string }[]>('companies/index.json').then((r) => { regNames = Object.fromEntries(r.map((c) => [c.name_he, c.id])); regIds = Object.fromEntries(r.map((c) => [c.id, c.name_he])); }, () => {});
export function idOfName(name: string): string | undefined {
  const n = name.trim();
  const all = { ...regNames, ...NAMES };
  if (all[n]) return all[n];
  // "הראל · CSM", "הראל, Q2'26": the company name leads
  const hit = Object.keys(all).sort((a, b) => b.length - a.length).find((k) => n.startsWith(k) && /^[\s·,:(–-]/.test(n.slice(k.length)));
  const id = hit ? all[hit] : undefined;
  return id && hasIdentity(id) ? id : undefined;
}

const PERIOD = /^(Q[1-4]|H[12]|9M|FY)'\d\d$|^\d\d\/\d\d$|^LTM|^\d{4}$/;
export const routeNow = (): string => { const q = new URLSearchParams(location.search); q.delete('src'); const s = q.toString(); return location.pathname + (s ? `?${s}` : ''); };

/** The plotted data of a live chart as a spec. null when the chart type has no book form (heatmaps, gauges, custom). */
export function captureSpec(c: ECharts, meta: { label: string; credit?: string; onPoint?: (si: number, di: number, name: string) => void }): ChartSpec | null {
  const o = c.getOption() as Loose;
  const series = arr(o.series), xa = arr(o.xAxis), ya = arr(o.yAxis);
  if (!series.length) return null;
  const types = new Set(series.map((s) => String(s.type)));
  if ([...types].some((t) => !['bar', 'line', 'scatter', 'pie', 'effectScatter'].includes(t))) return null;
  if (series.every((s) => s.type === 'line' || s.type === 'bar') && xa[0]?.type === 'value' && ya[0]?.type === 'value' && !series.some((s) => arr(s.data).some((p) => Array.isArray(p) || Array.isArray((p as Loose)?.value)))) return null;
  const visual = (i: number): string | null => { try { return hex(c.getVisual({ seriesIndex: i }, 'color') as string); } catch { return null; } };
  const colorOf = (s: Loose, i: number) => hex((s.itemStyle as Loose | undefined)?.color) ?? hex((s.lineStyle as Loose | undefined)?.color) ?? visual(i) ?? undefined;
  let kind: BookKind, cats: string[] = [], unit = '', unit2: string | undefined, vmin: number | undefined, xName: string | undefined, yName: string | undefined;
  const out: BookSeries[] = [];
  if (types.has('pie')) {
    kind = 'pie';
    const s = series.find((x) => x.type === 'pie')!, d = arr(s.data);
    cats = d.map((x) => String(x.name ?? ''));
    out.push({ name: String(s.name ?? meta.label), type: 'pie', data: d.map(num), pointColors: d.map((x, i) => hex((x.itemStyle as Loose | undefined)?.color) ?? (() => { try { return hex(c.getVisual({ seriesIndex: series.indexOf(s), dataIndex: i }, 'color') as string); } catch { return null; } })()) });
  } else if (types.has('scatter') || types.has('effectScatter') || (xa[0]?.type === 'value' && ya[0]?.type === 'value')) {
    // points on two value axes; the site draws them as scatter or as lines without a stroke (the shared bundle has no scatter)
    kind = 'scatter';
    xName = String(xa[0]?.name ?? ''); yName = String(ya[0]?.name ?? '');
    series.forEach((s, i) => {
      if (s.type === 'pie') return;
      const name = String(s.name ?? ''), lab = (s.label ?? {}) as Loose, d = arr(s.data);
      const stroke = s.type === 'line' && ((s.lineStyle as Loose | undefined)?.opacity ?? 1) !== 0;
      const nameOf = (p: unknown, k: number): string | undefined => {
        if (p && typeof p === 'object' && !Array.isArray(p) && (p as Loose).name != null) return String((p as Loose).name);
        if (typeof lab.formatter === 'string' && !lab.formatter.includes('{')) return lab.formatter;
        if (typeof lab.formatter === 'function') { try { const t = (lab.formatter as (x: unknown) => unknown)({ dataIndex: k, seriesIndex: i, seriesName: name, data: p, value: Array.isArray(p) ? p : (p as Loose)?.value }); if (typeof t === 'string' && t) return t; } catch { /* no name */ } }
        return d.length === 1 && name ? name : undefined;
      };
      const pts = d.map((p, k) => { const v = (Array.isArray(p) ? p : (p as Loose)?.value) as unknown[]; return Array.isArray(v) && num(v[0]) != null && num(v[1]) != null ? { xy: [num(v[0])!, num(v[1])!, nameOf(p, k)] as [number, number, string?], c: p && typeof p === 'object' && !Array.isArray(p) ? hex(((p as Loose).itemStyle as Loose | undefined)?.color) : null } : null; }).filter((p): p is { xy: [number, number, string?]; c: string | null } => !!p);
      if (stroke) { out.push({ name, type: 'line', data: [], xy: pts.map((p) => p.xy), color: colorOf(s, i), dashed: (s.lineStyle as Loose | undefined)?.type === 'dashed' || undefined }); return; }
      // one series that colours its points one by one (a point per company): a series per point, so each keeps its identity
      if (pts.length > 1 && pts.some((p) => p.c) && pts.every((p) => p.xy[2])) { pts.forEach((p) => out.push({ name: p.xy[2]!, type: 'scatter', data: [], xy: [p.xy], id: idOfName(p.xy[2]!), color: p.c ?? colorOf(s, i) })); return; }
      out.push({ name, type: 'scatter', data: [], xy: pts.map((p) => p.xy), id: idOfName(name), color: colorOf(s, i) });
    });
  } else {
    const horiz = xa[0]?.type === 'value' && ya[0]?.type === 'category';
    kind = horiz ? 'hbar' : 'cat';
    const catAxis = horiz ? ya[0] : xa[0], valAxes = horiz ? xa : ya;
    cats = arr(catAxis?.data).map((x) => String(typeof x === 'object' && x ? (x as Loose).value ?? '' : x ?? ''));
    if (!cats.length) { const first = arr(series[0]?.data); cats = first.map((_, i) => String(i + 1)); }
    // the label the axis prints (a formatter turns ids into names): its first line, rich-text markup dropped
    const fmt = (catAxis?.axisLabel as Loose | undefined)?.formatter;
    if (typeof fmt === 'function') cats = cats.map((c, i) => { try { const t = (fmt as (v: string, i: number) => unknown)(c, i); return typeof t === 'string' && t.trim() ? t.replace(/\{[a-zA-Z0-9_]+\|([^}]*)\}/g, '$1').split('\n')[0].replace(/[\u200E\u200F]/g, '').trim() || c : c; } catch { return c; } });
    cats = cats.map((c) => (hasIdentity(c) ? regIds[c] ?? (c === 'direct' ? 'ביטוח ישיר' : c) : c));
    unit = String(valAxes[0]?.name ?? '');
    unit2 = valAxes[1] ? String(valAxes[1].name ?? '') : undefined;
    if (typeof valAxes[0]?.min === 'number') vmin = valAxes[0].min as number;
    series.forEach((s, i) => {
      const d = arr(s.data), name = String(s.name ?? '');
      const pc = d.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? hex(((x as Loose).itemStyle as Loose | undefined)?.color) : null));
      const t: BookSeries['type'] = s.type === 'line' ? (s.areaStyle ? 'area' : 'line') : 'bar';
      out.push({
        name, type: t, data: cats.map((_, k) => num(d[k])), id: idOfName(name), color: colorOf(s, i),
        pointColors: pc.some(Boolean) ? pc : undefined, stack: s.stack ? String(s.stack) : undefined,
        axis: Number(horiz ? s.xAxisIndex ?? 0 : s.yAxisIndex ?? 0) === 1 ? 1 : 0, hidden: invisible(s) || undefined,
        dashed: (s.lineStyle as Loose | undefined)?.type === 'dashed' || undefined,
      });
    });
    // a bar per company: the category carries the identity
    if (horiz) { /* ECharts lists the first category at the bottom unless the axis is inverted; the spec keeps reading order */
      if (!(catAxis as Loose).inverse) { cats.reverse(); out.forEach((s) => { s.data.reverse(); s.pointColors?.reverse(); }); }
    }
  }
  const pcs = cats.filter((x) => PERIOD.test(x));
  const span = kind !== 'pie' && kind !== 'scatter' && pcs.length >= 2 && pcs.length === cats.length ? `${cats[0]}–${cats[cats.length - 1]}` : undefined;
  // the source of every plotted point, through the chart's own handler
  const provs = meta.onPoint ? collect(() => {
    let calls = 0;
    series.forEach((s, si) => {
      if (invisible(s)) return;
      const d = arr(s.data);
      d.forEach((x, di) => { if (calls > 800) return; if (num(x) == null && !(s.type === 'scatter' || s.type === 'pie')) return; calls++; meta.onPoint!(si, di, String(s.name ?? '')); });
    });
  }) : [];
  const refs = uniqRefs([...provs.flatMap((p) => refsOf(p)), ...(meta.credit ? [{ kind: 'text' as const, label: meta.credit }] : [])]).slice(0, 300);
  const route = routeNow(), now = new Date().toISOString();
  return {
    v: 1, id: Math.random().toString(36).slice(2, 10), key: `${route}|${meta.label}`, title: meta.label, label: meta.label, route,
    params: Object.fromEntries(new URLSearchParams(location.search)), kind, cats, series: out, unit, unit2, vmin, xName, yName, span,
    sources: refs, credit: meta.credit, added: now, updated: now,
  };
}

/** Names the documents the way a reader knows them ("הראל · דוח רבעוני Q2'26") and stamps the data date. */
export async function enrich(spec: ChartSpec): Promise<ChartSpec> {
  const [qa, reg] = await Promise.all([
    load<{ built?: string }>('qa.json').catch(() => null), load<{ id: string; name_he: string }[]>('companies/index.json').catch(() => []),
  ]);
  const corpus = await loadCorpus().catch(() => null);
  const names = new Map(reg.map((c) => [c.id, c.name_he]));
  const sources = spec.sources.map((r) => {
    if (r.kind !== 'report' && r.kind !== 'xbrl') return r;
    const rid = ridOf(r.file ?? r.url), d = rid ? corpus?.byId.get(rid) : undefined;
    if (!d) return r;
    return { ...r, doc: `${names.get(d.company) ?? d.company} · ${r.kind === 'xbrl' ? 'XBRL ' : ''}${DOC_TYPE_HE[d.type]} ${repName(d.period)}` };
  });
  return { ...spec, sources, dataDate: qa?.built?.slice(0, 10) ?? spec.dataDate };
}

/** true when two specs plot the same thing (same categories and series); only their figures may differ */
export const sameShape = (a: ChartSpec, b: ChartSpec) => a.kind === b.kind && a.cats.join('|') === b.cats.join('|') && a.series.map((s) => s.name).join('|') === b.series.map((s) => s.name).join('|');
export const sameData = (a: ChartSpec, b: ChartSpec) => JSON.stringify(a.series.map((s) => [s.data, s.xy])) === JSON.stringify(b.series.map((s) => [s.data, s.xy]));

/* ---------- storage ---------- */
export function readBook(): Book {
  try { const raw = localStorage.getItem('fox:book'); return raw ? { ...EMPTY, ...(JSON.parse(raw) as Book) } : EMPTY; } catch { return EMPTY; }
}
export function useBook() {
  const [book, set] = useStored<Book>('book', EMPTY);
  const items = book.items ?? [];
  const put = useCallback((items: ChartSpec[], title?: string) => set({ v: 1, title: title ?? readBook().title, items }), [set]);
  return {
    book, items,
    has: (key: string) => items.some((x) => x.key === key),
    /** adds the chart, or refreshes its figures when it is already in the book (title and note kept) */
    add: (s: ChartSpec) => { const cur = readBook().items, i = cur.findIndex((x) => x.key === s.key); put(i < 0 ? [...cur, s] : cur.map((x, k) => (k === i ? { ...s, id: x.id, title: x.title, note: x.note, added: x.added } : x))); },
    remove: (id: string) => put(readBook().items.filter((x) => x.id !== id)),
    update: (id: string, patch: Partial<ChartSpec>) => put(readBook().items.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    move: (id: string, to: number) => { const cur = [...readBook().items], i = cur.findIndex((x) => x.id === id); if (i < 0) return; const [x] = cur.splice(i, 1); cur.splice(Math.max(0, Math.min(cur.length, to)), 0, x); put(cur); },
    setTitle: (title: string) => put(readBook().items, title),
    clear: () => put([]),
  };
}
