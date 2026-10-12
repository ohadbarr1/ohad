import type { Track } from '../lib/prov';
import { useLoad } from '../lib/useData';
import { nf, sn } from '../lib/format';
import { pdfPage } from '../lib/sources';
import '../styles/recon.css';

type Status = 'match' | 'close' | 'gap' | 'near';
interface Line { l: string; v: number; pg: number; u?: number }
interface Row { d: number; reg: number; n: number; v: number; pct: number; st: Status; pg: number; u: number; doc?: string; l: string; unit: string;
  rnd?: number; text?: 1; cmp?: 1; parts?: [string, number][]; tot?: number; out?: Line[]; minus?: Line[]; info?: Line }
interface ReconData { asof: number; status: Record<Status, string>; families: Record<string, string>; reg: Record<string, string>; urls: string[];
  groups: Record<string, { company: string; fam: Record<string, Row[]> }> }

const ORDER = ['pension', 'gemel', 'pg', 'insurance'];
const CHIP: Record<Status, string> = { match: 'pass', close: 'review', gap: 'review gap', near: 'est' };
/** 202512 -> FY'25, 202606 -> Q2'26 */
const dateLabel = (d: number) => { const y = String(Math.floor(d / 100)).slice(2), m = d % 100; return m === 12 ? `FY'${y}` : `Q${m / 3}'${y}`; };
/** "2025FY" -> FY'25, "2026Q2" -> Q2'26 */
const docLabel = (k: string) => `${k.slice(4)}'${k.slice(2, 4)}`;
const fig = (v: number) => nf(v, Number.isInteger(v) ? 0 : 1);

/** Reconciliation of a regulator aggregate with the figure the company prints in its report. Filled by recon.json. */
export function Recon({ group, period }: { group: string; period: number; tracks: Track[] }) {
  const { data } = useLoad<ReconData>('recon.json');
  const fams = data?.groups[group]?.fam;
  if (!data || !fams) return null;
  // per family: the latest balance-sheet date, not after the month shown, for which the report prints a counterpart
  const rows = ORDER.flatMap((f) => { const r = (fams[f] ?? []).filter((x) => x.d <= period).pop(); return r ? [{ f, r }] : []; });
  if (!rows.length) return null;
  const href = (u: number, pg: number) => pdfPage(data.urls[u], pg);
  return (
    <section className="recon" aria-label="מול הדוח הכספי">
      <div className="recon-h"><b>מול הדוח הכספי</b><span className="muted">מיליוני ש"ח</span></div>
      {rows.map(({ f, r }) => (
        <div className="recon-row" key={f}>
          <div className="recon-t">
            <b>{data.families[f]}</b>
            <span className="num muted">{dateLabel(r.d)}</span>
            <span className={`chip ${CHIP[r.st]}`}>{data.status[r.st]}</span>
          </div>
          <dl className="recon-n">
            <div><dt>{data.reg[f]}</dt><dd className="num">{nf(r.reg, 1)}</dd></div>
            <div>
              <dt>דוח{r.doc && docLabel(r.doc) !== dateLabel(r.d) ? ` ${docLabel(r.doc)}` : ''}, עמ׳ <span className="num">{r.pg}</span></dt>
              <dd className="num"><a href={href(r.u, r.pg)} target="_blank" rel="noreferrer" title={r.l}>{r.rnd ? '~' : ''}{fig(r.v)}</a></dd>
            </div>
            <div><dt>פער</dt><dd className="num">{sn(r.pct, Math.abs(r.pct) < 1 ? 2 : 1)}%</dd></div>
          </dl>
          <div className="recon-x">
            <span>{r.l}{r.parts ? ' (Σ)' : ''}{r.text ? ' · טקסט' : ''}{r.rnd ? <> · <span className="num">±{nf(r.rnd / 2, 0)}</span></> : ''}</span>
            {r.minus?.map((x) => <span key={x.l}>נוכה: {x.l.split(':')[0]} <a className="num" href={href(r.u, x.pg)} target="_blank" rel="noreferrer">{fig(x.v)}</a>, עמ׳ <span className="num">{x.pg}</span></span>)}
            {r.out?.map((x) => <span key={x.l}>מחוץ למאגר: {x.l} <a className="num" href={href(r.u, x.pg)} target="_blank" rel="noreferrer">{fig(x.v)}</a></span>)}
            {r.info && <span>מזה {r.info.l} <a className="num" href={href(r.info.u ?? r.u, r.info.pg)} target="_blank" rel="noreferrer">{fig(r.info.v)}</a>, עמ׳ <span className="num">{r.info.pg}</span></span>}
          </div>
        </div>
      ))}
    </section>
  );
}
