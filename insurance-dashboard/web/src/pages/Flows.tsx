import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { FlowDef } from '../components/FlowDef';
import { MgrChip } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { DataTable, type Column } from '../components/DataTable';
import { Empty, Loading, Panel, Pick } from '../components/ui';
import { useOptional, useClosed } from '../lib/fundsLoad';
import { useFunds, useLoad } from '../lib/useData';
import { nf } from '../lib/format';
import type { Prov } from '../lib/prov';
import { FLOWS_PATH, FIELD_HE, cellProv, headline, monthPath, prodPath, scoreRows, winProv, ym, type Field, type FlowsIndex, type FlowsMonth, type FlowsProd, type ScoreRow } from '../lib/flows';
import '../styles/flows.css';

/* Wave 3 · /flows "מי ניצח החודש": per product and month, every management group's net transfers taken apart (pipeline/build_flows.py):
   the intra-group migration (already netted in the group's sum, shown so the track-level reading is not mistaken for a loss), the
   default-fund tender effect (comprehensive pension), closing transfers, and what remains, the competitive transfers, with its rank and
   its 3M / 12M sums. Every cell opens its tracks. Numbers only; the one headline line is generated from the table. */

const dateHe = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '–');

export function Flows() {
  const idx = useOptional<FlowsIndex>(FLOWS_PATH);
  const [sp, setSp] = useSearchParams();
  const prodId = idx?.prods.some((p) => p.id === sp.get('prod')) ? sp.get('prod')! : 'pm';
  const prod = useOptional<FlowsProd>(prodPath(prodId));
  const ok = prod && prod.id === prodId ? prod : null;
  // the months of the product with flows (or assets, for the insurance products), latest first
  const months = useMemo(() => {
    if (!ok) return [];
    const has = ok.flows ? ok.tot.nf : ok.tot.a;
    return ok.months.filter((_, j) => has?.[j] != null).reverse();
  }, [ok]);
  const asked = Number(sp.get('m'));
  const p = months.includes(asked) ? asked : months[0];
  const mfile = useLoad<FlowsMonth>(p ? monthPath(p) : null).data;
  const F = useFunds().data, C = useClosed();
  const names = useMemo(() => { const m = new Map<string, string>(); F?.funds.forEach((f) => m.set(f.k, f.name)); C?.forEach((f) => m.set(f.k, f.name)); return m; }, [F, C]);
  const set = (k: string, v: string | null) => setSp((cur) => { const n = new URLSearchParams(cur); if (v == null) n.delete(k); else n.set(k, v); if (k === 'prod') n.delete('m'); return n; }, { replace: true });

  if (idx === undefined) return <Loading what="תזרימים" />;
  if (idx === null) return <Empty title="קובץ התזרימים לא פורסם עדיין" icon="funds" />;
  const meta = idx.prods.find((x) => x.id === prodId)!;
  const cov = idx.coverage.prods.find((x) => x.id === prodId);
  const j = ok && p ? ok.months.indexOf(p) : -1;
  const rows = ok && j >= 0 ? scoreRows(ok, j, idx.bucket) : [];
  const pm = prodId === 'pm';
  const rowsOf = (grp: string) => (mfile && mfile.p === p ? mfile.g[prodId]?.[grp] ?? (grp === 'tot' ? Object.values(mfile.g[prodId] ?? {}).flat() : []) : null);
  const src = (grp: string, f: Field, value: number | null) => () => cellProv({ idx, prod: ok!, grp, p: p!, f, value, rows: rowsOf(grp), name: (k) => names.get(k) ?? k });
  const monthSrc = (grp: string, f: Field) => (q: number) => (q === p ? src(grp, f, ok!.groups[grp]?.[f]?.[j] ?? null) : undefined);
  const W = (grp: string, f: Field, n: number, v: number | null) => () => winProv(ok!, grp, f, j, n, v, monthSrc(grp, f));
  const num = (v: number | null, s: () => Prov, tone = true, d = 0) => (v == null ? <span className="muted">–</span>
    : <Sourced src={s}><span className={`num${tone ? (v > 0 ? ' pos' : v < 0 ? ' neg' : '') : ''}`}>{nf(v, d)}</span></Sourced>);
  const T = ok?.tot;
  const tv = (f: Field) => T?.[f]?.[j] ?? null;
  const col = (key: Field | 'comp3' | 'comp12' | 'tr3' | 'tr12' | 'org3' | 'org12', head: string, opt: { title?: string; tone?: boolean; className?: string } = {}): Column<ScoreRow> => {
    const base = key.replace(/\d+$/, '') as Field, n = key.endsWith('12') ? 12 : key.endsWith('3') ? 3 : 0;
    const s = (r: ScoreRow) => (n ? W(r.grp, base, n, r[key as keyof ScoreRow] as number | null) : src(r.grp, base, r[key as keyof ScoreRow] as number | null));
    return { key, head, title: opt.title, className: opt.className, value: (r) => r[key as keyof ScoreRow] as number | null,
      cell: (r) => num(r[key as keyof ScoreRow] as number | null, s(r), opt.tone ?? true),
      total: () => { const v = n ? (T ? (() => { const xs = T[base]; let t = 0; for (let i = j - n + 1; i <= j; i++) { const x = xs?.[i]; if (i < 0 || x == null) return null; t += x; } return Math.round(t * 10) / 10; })() : null) : tv(base);
        return v == null ? <span className="muted">–</span> : num(v, n ? W('tot', base, n, v) : src('tot', base, v), opt.tone ?? true); } };
  };
  const columns: Column<ScoreRow>[] = meta.flows ? [
    { key: 'rk', head: 'מקום', value: (r) => r.rk, firstDir: 'asc', title: idx.method.rk, cell: (r) => (r.rk == null ? <span className="muted">–</span> : <Sourced src={src(r.grp, 'rk', r.rk)}><span className="num">{r.rk}</span></Sourced>) },
    { key: 'grp', head: 'קבוצה', value: (r) => r.grp, tdClass: () => 'lbl', cell: (r) => <>{r.grp}{!r.bucket && <span className="fund-mgr"><MgrChip grp={r.grp} /></span>}</> },
    col('comp', 'ניוד תחרותי', { title: idx.method.comp }),
    col('comp3', 'תחרותי 3M', { title: idx.method.win }),
    col('comp12', 'תחרותי 12M', { title: idx.method.win }),
    col('tr', 'ניוד נטו', { title: idx.method.tr }),
    ...(pm ? [col('dt', 'מזה: ברירת מחדל', { title: idx.method.dt })] : []),
    col('cl', 'מזה: סגירת מסלולים', { title: idx.method.cl }),
    col('mig', 'נדידה פנימית, קוזזה', { title: idx.method.mig, tone: false }),
    col('org', 'צבירה אורגנית', { title: idx.method.org }),
    ...(pm ? [col('dd', 'מזה: הפקדות לברירת מחדל', { title: idx.method.dd, tone: false })] : []),
    col('org12', 'אורגנית 12M', { title: idx.method.win, className: 'wide-only' }),
    col('a', 'נכסים', { tone: false }),
    col('res', 'לא מוסבר', { title: idx.method.res, className: 'wide-only' }),
  ] : [
    { key: 'grp', head: 'קבוצה', value: (r) => r.grp, tdClass: () => 'lbl', cell: (r) => <>{r.grp}{!r.bucket && <span className="fund-mgr"><MgrChip grp={r.grp} /></span>}</> },
    col('a', 'נכסים', { tone: false }),
    col('n', 'מסלולים', { tone: false }),
  ];
  const line = ok && j >= 0 && meta.flows ? headline(ok, j, idx.bucket) : null;
  const prodOpts: [string, string][] = idx.prods.map((x) => [x.id, x.label + (x.flows ? '' : ' (נכסים בלבד)')]);
  const tend = pm && p ? idx.tenders.filter((t) => t.from <= p && p <= t.to) : [];

  return (
    <>
      <FundsHead title="מי ניצח החודש" sub={<>תזרימים לפי קבוצה ומוצר · נתוני <span className="num">{ym(idx.asof)}</span> · התקבל <span className="num">{dateHe(idx.received)}</span> · מיליוני ש"ח · <Link className="sv-u" to="/managers">דירוג מנהלים</Link> · <Link className="sv-u" to={`/flows/letter/${idx.asof}`} data-testid="flows-letter-link">מכתב התזרימים {ym(idx.asof)}: להטמעה ולציטוט</Link></>}
        tools={<>
          <Pick label="מוצר" cap="מוצר" value={prodId} onChange={(v) => set('prod', v)} options={prodOpts} />
          {months.length > 0 && p && <Pick label="חודש" cap="חודש" value={String(p)} onChange={(v) => set('m', v)} options={months.map((q) => [String(q), ym(q)] as [string, string])} />}
        </>} />
      <Panel className="flows" aside={<span>{meta.label} · {p ? ym(p) : '–'}</span>}>
        <FlowDef kinds={['transfers', 'organic']} />
        <p className="flowdef flows-comp"><span>{idx.method.comp}</span></p>
        {line && <p className="flows-line" data-testid="flows-headline">{line}</p>}
        {!ok ? <Loading what={meta.label} /> : !meta.flows ? <p className="flows-gap">{cov?.note}. מוצגים נכסים בלבד.</p> : null}
        {ok && <DataTable caption={`מי ניצח · ${meta.label} · ${p ? ym(p) : ''}`} rows={rows} rowKey={(r) => r.grp} columns={columns} totalLabel={`סה"כ ${meta.label}`}
          rowClass={(r) => (r.bucket ? 'sec' : undefined)}
          export={{ name: `fox-flows-${prodId}-${p}`, title: `מי ניצח · ${meta.label} · ${p ? ym(p) : ''}`, note: `${idx.src} · נתוני ${ym(idx.asof)}, התקבל ${dateHe(idx.received)} · מיליוני ש"ח · ${idx.method.comp}` }} />}
        <div className="fnote">
          {pm && tend.length > 0 && <>קרנות ברירת מחדל בחודש זה: {tend.map((t) => `${t.label} (${ym(t.from)}–${ym(t.to)}): ${t.winners.map((w) => w.grp).join(', ')}`).join('; ')}. </>}
          {idx.bucket}: לא קבוצה אחת, ולכן בלי מקום. {idx.coverage.group}.
        </div>
      </Panel>
      <Panel title="כיסוי ומגבלות">
        <ul className="flows-cov">
          {cov && cov.flows_from && <li>{meta.label}: נכסים מ-<span className="num">{ym(cov.assets_from)}</span>, תזרימים מ-<span className="num">{ym(cov.flows_from)}</span>{cov.thin_n > 0 ? <> · <span className="num">{cov.thin_n}</span> חודשים שבהם התזרימים מכסים פחות מ-99% מהנכסים (לא הושלמו)</> : null}.</li>}
          {cov && !cov.flows_from && <li>{meta.label}: {cov.note}.</li>}
          <li>{idx.coverage.tr_split}.</li>
          {pm && <li>{idx.coverage.default}. תקופות: {idx.tenders.map((t) => `${t.label} ${ym(t.from)}–${ym(t.to)} (${t.months} חודשים)`).join('; ')}.</li>}
          <li>{idx.coverage.fees}.</li>
          {idx.coverage.nd_off > 0 && <li>{idx.coverage.nd_note}: <span className="num">{idx.coverage.nd_off}</span>.</li>}
        </ul>
        <div className="fnote">{FIELD_HE.mig}: {idx.method.mig}.</div>
      </Panel>
    </>
  );
}
