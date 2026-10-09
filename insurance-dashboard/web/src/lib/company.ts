import type { CompanyData, CompanyMetric, CompanyPeriod } from './types';
import { periodLabel } from './format';

export interface Row { idx: number; m: CompanyMetric; values: Map<number, { v: number; page: number | null }> }
export interface SheetView { code: string; entity: 'F' | 'I'; group: string; title: string; rows: Row[]; periods: CompanyPeriod[]; periodIdx: number[]; dims: string[] }

/** Read-only index over the facts of one company. */
export class CompanyStore {
  readonly byMetric = new Map<number, Map<number, { v: number; page: number | null }>>();
  readonly metricsBySheet = new Map<string, number[]>();

  constructor(readonly d: CompanyData) {
    for (const [mi, pi, v, page] of d.facts) {
      let m = this.byMetric.get(mi);
      if (!m) { m = new Map(); this.byMetric.set(mi, m); }
      m.set(pi, { v, page });
    }
    d.metrics.forEach((m, i) => {
      const arr = this.metricsBySheet.get(m.sheet) ?? [];
      arr.push(i); this.metricsBySheet.set(m.sheet, arr);
    });
  }

  period(pi: number): CompanyPeriod { return this.d.periods[pi]; }
  plabel(pi: number): string { const p = this.d.periods[pi]; return periodLabel(p.type, p.end); }

  sheet(code: string): SheetView | null {
    const meta = this.d.sheets.find((s) => s.code === code);
    const ids = this.metricsBySheet.get(code);
    if (!meta || !ids) return null;
    const rows: Row[] = ids.map((idx) => ({ idx, m: this.d.metrics[idx], values: this.byMetric.get(idx) ?? new Map() }));
    const used = new Set<number>();
    rows.forEach((r) => r.values.forEach((_, pi) => used.add(pi)));
    const periodIdx = [...used].sort((a, b) => this.d.periods[a].end.localeCompare(this.d.periods[b].end) || this.d.periods[a].months - this.d.periods[b].months);
    const dims = [...new Set(rows.filter((r) => !r.m.header && r.m.dim).map((r) => r.m.dim as string))];
    return { code, entity: meta.entity, group: meta.group, title: meta.title, rows, periods: periodIdx.map((i) => this.d.periods[i]), periodIdx, dims };
  }

  /** First value row of a sheet whose label matches. `exact` compares after dropping "(ביאור 3)"-style remarks and extra spaces. */
  find(sheet: string, label: string, opts: { dim?: string; exact?: boolean } = {}): number | null {
    const ids = this.metricsBySheet.get(sheet) ?? [];
    const want = norm(label);
    for (const i of ids) {
      const m = this.d.metrics[i];
      if (m.header) continue;
      const have = norm(m.label);
      if (opts.exact ? have !== want : !have.includes(want)) continue;
      if (opts.dim !== undefined && !(m.dim ?? '').startsWith(opts.dim)) continue;
      return i;
    }
    return null;
  }
  periodIndex(type: string, end: string): number {
    return this.d.periods.findIndex((p) => p.type === type && p.end === end);
  }
  val(mi: number | null, pi: number): number | null {
    if (mi == null || pi < 0) return null;
    return this.byMetric.get(mi)?.get(pi)?.v ?? null;
  }
  page(mi: number | null, pi: number): number | null {
    if (mi == null || pi < 0) return null;
    return this.byMetric.get(mi)?.get(pi)?.page ?? null;
  }
  sourceUrl(entity: 'F' | 'I', page: number | null): string | null {
    const s = this.d.sources.find((x) => x.entity === entity);
    if (!s?.url) return null;
    return page ? `${s.url}#page=${page}` : s.url;
  }
}

const STATEMENTS: Record<string, string> = { D1: 'מאזן', D2: 'רווח והפסד', D3: 'רווח כולל', D4: 'שינויים בהון', D5: 'תזרים מזומנים' };
export function sheetName(code: string): string {
  const body = code.split('.')[1];
  const m = body.match(/^([A-Z])(\d+)?(?:_([א-ת]))?(?:_(.*))?$/);
  if (!m) return body.replace(/_/g, ' ');
  const [, kind, num, , rest] = m;
  const tail = (rest ?? '').replace(/_/g, ' ').trim();
  if (kind === 'D') return `${STATEMENTS[`D${num}`] ?? body}${tail && !/^\d$/.test(tail) ? ' ' + tail : ''}`;
  if (kind === 'N') return `ביאור ${num}${tail ? ' · ' + tail : ''}`;
  if (kind === 'S') return `מידע נפרד${tail ? ' · ' + tail : ''}`;
  if (kind === 'A') return `נספח א׳${tail ? ' · ' + tail : ''}`;
  return body.replace(/_/g, ' ');
}

export function norm(s: string): string {
  return s.replace(/\([^)]*\)/g, '').replace(/[*]/g, '').replace(/\s+/g, ' ').trim();
}
export function shiftYear(end: string, delta: number): string {
  return `${Number(end.slice(0, 4)) + delta}${end.slice(4)}`;
}
