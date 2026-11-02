import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '../DataTable';
import { MgrChip } from '../MgrChip';
import { Sourced } from '../Source';
import { Empty, ErrorBox, Loading, Panel, Pick } from '../ui';
import { useOptional } from '../../lib/fundsLoad';
import { useFunds } from '../../lib/useData';
import { fundP, type TrackRef } from '../../lib/market';
import { nf, sn } from '../../lib/format';
import { refOf, type FundX } from '../../lib/funds';
import type { Prov } from '../../lib/prov';
import { FEES_PATH, ym, type FeeRow, type FeesFile } from '../../lib/flows';

/* Wave 3 · /managers?v=feechg "שינויי דמי ניהול": the tracks whose average management fee (ממוצע בפועל) moved most over 12 months, per
   product, and the asset-weighted change of each group (flows/fees.json, pipeline/build_flows.py). */

const PRODS = ['פנסיה מקיפה', 'גמל', 'השתלמות', 'גמל להשקעה', 'פנסיה כללית', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'];
type Row = FeeRow & { f: FundX; R: TrackRef };

function d12Prov(r: Row, asof: number): Prov {
  return { k: 'calc', title: `שינוי דמי ניהול מצבירה, 12 חודשים · ${r.f.name}`, value: `${sn(r.d12!, 1)} נ"ב`, formula: '(דמי הניהול הממוצעים בפועל ב-asof − 12 חודשים קודם) × 100',
    inputs: [{ label: ym(asof), v: `${nf(r.fee, 2)}%`, src: () => fundP(r.R, asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${nf(r.fee, 2)}%`) },
      { label: ym(asof - 100), v: `${nf(r.fee12!, 2)}%`, src: () => fundP(r.R, asof - 100, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${nf(r.fee12!, 2)}%`) }] };
}

export function FeeMovers() {
  const fees = useOptional<FeesFile>(FEES_PATH);
  const { data, error } = useFunds();
  const [sp, setSp] = useSearchParams();
  const prod = PRODS.includes(sp.get('fp') ?? '') ? sp.get('fp')! : PRODS[0];
  const rows = useMemo(() => {
    if (!fees || !data) return [];
    const by = new Map((data.funds as FundX[]).map((f) => [f.k, f]));
    return fees.rows.filter((r) => r.prod === prod && r.d12 != null && by.has(r.k) && !by.get(r.k)!.closed).map((r) => ({ ...r, f: by.get(r.k)!, R: refOf(by.get(r.k)!) }));
  }, [fees, data, prod]);
  const groups = useMemo(() => {
    const m = new Map<string, { a: number; w: number; n: number; rows: Row[] }>();
    rows.forEach((r) => { if (!(r.a && r.a > 0)) return; const e = m.get(r.grp) ?? { a: 0, w: 0, n: 0, rows: [] }; e.a += r.a; e.w += r.a * r.d12!; e.n++; e.rows.push(r); m.set(r.grp, e); });
    return [...m.entries()].map(([grp, e]) => ({ grp, d: Math.round(e.w / e.a * 10) / 10, a: e.a, n: e.n, rows: e.rows })).sort((x, y) => y.d - x.d);
  }, [rows]);
  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (fees === undefined || !data) return <Loading what="דמי ניהול" />;
  if (fees === null) return <Empty title="קובץ דמי הניהול לא פורסם עדיין" icon="funds" />;
  const movers = [...rows].sort((a, b) => Math.abs(b.d12!) - Math.abs(a.d12!) || (b.a ?? 0) - (a.a ?? 0)).slice(0, 30);
  const gProv = (g: (typeof groups)[number]): Prov => ({ k: 'calc', title: `שינוי דמי ניהול, 12 חודשים · ${g.grp} · ${prod}`, value: `${sn(g.d, 1)} נ"ב`,
    formula: 'ממוצע השינוי של מסלולי הקבוצה במוצר, משוקלל בנכסים של היום; רק מסלולים שפרסמו דמי ניהול בשני החודשים',
    inputs: [...g.rows].sort((a, b) => (b.a ?? 0) - (a.a ?? 0)).map((r) => ({ label: `${r.f.name} · נכסים ${nf(r.a ?? 0, 0)}`, v: `${sn(r.d12!, 1)} נ"ב`, src: () => d12Prov(r, fees.asof) })) });
  return (
    <>
      <Panel aside={<span>ממוצע בפועל · {ym(fees.asof - 100)} מול {ym(fees.asof)} · נקודות בסיס</span>}>
        <div className="flowdef"><Pick label="מוצר" cap="מוצר" value={prod} onChange={(v) => setSp((c) => { const n = new URLSearchParams(c); n.set('fp', v); return n; }, { replace: true })} options={PRODS.map((p) => [p, p] as [string, string])} /></div>
        <DataTable caption={`שינוי דמי ניהול לפי קבוצה · ${prod}`} rows={groups} rowKey={(g) => g.grp} export={{ name: `fox-fee-change-groups-${fees.asof}`, title: `שינוי דמי ניהול מצבירה, 12 חודשים · ${prod}`, note: `${fees.method}` }}
          columns={[
            { key: 'grp', head: 'קבוצה', value: (g) => g.grp, tdClass: () => 'lbl', cell: (g) => <>{g.grp}<span className="fund-mgr"><MgrChip grp={g.grp} /></span></> },
            { key: 'd', head: 'שינוי, נ"ב', value: (g) => g.d, cell: (g) => <Sourced src={() => gProv(g)}><span className={`num ${g.d > 0 ? 'neg' : g.d < 0 ? 'pos' : ''}`}>{sn(g.d, 1)}</span></Sourced> },
            { key: 'n', head: 'מסלולים', value: (g) => g.n, unit: 'int' },
            { key: 'a', head: 'נכסים, מיליוני ש"ח', value: (g) => g.a, d: 0 },
          ]} />
      </Panel>
      <Panel title="המסלולים שזזו הכי הרבה" aside={<span>30 המסלולים עם השינוי הגדול ביותר בערך מוחלט</span>}>
        <DataTable caption={`מסלולים לפי שינוי דמי ניהול · ${prod}`} rows={movers} rowKey={(r) => r.k} export={{ name: `fox-fee-change-tracks-${fees.asof}`, title: `שינוי דמי ניהול מצבירה, 12 חודשים · ${prod}`, note: fees.method }}
          columns={[
            { key: 'name', head: 'מסלול', value: (r) => r.f.name, tdClass: () => 'lbl', cell: (r) => <Link to={`/funds/${r.k}`}>{r.f.name}</Link> },
            { key: 'grp', head: 'קבוצה', value: (r) => r.grp },
            { key: 'fee12', head: `${ym(fees.asof - 100)}`, value: (r) => r.fee12, cell: (r) => <Sourced src={() => fundP(r.R, fees.asof - 100, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${nf(r.fee12!, 2)}%`)}><span className="num">{nf(r.fee12!, 2)}%</span></Sourced> },
            { key: 'fee', head: `${ym(fees.asof)}`, value: (r) => r.fee, cell: (r) => <Sourced src={() => fundP(r.R, fees.asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', `${nf(r.fee, 2)}%`)}><span className="num">{nf(r.fee, 2)}%</span></Sourced> },
            { key: 'd12', head: 'שינוי, נ"ב', value: (r) => r.d12, cell: (r) => <Sourced src={() => d12Prov(r, fees.asof)}><span className={`num ${r.d12! > 0 ? 'neg' : r.d12! < 0 ? 'pos' : ''}`}>{sn(r.d12!, 1)}</span></Sourced> },
            { key: 'log', head: 'מהלכים של 5 נ"ב+, 36 חודשים', value: (r) => r.log.length, unit: 'int', className: 'wide-only' },
            { key: 'a', head: 'נכסים', value: (r) => r.a ?? null, d: 0, className: 'wide-only' },
          ]} />
        <div className="fnote">{fees.method}.{fees.rows.some((r) => r.df != null) ? '' : ' דמי ניהול מהפקדה: אין סדרה חודשית בקבצי ההיסטוריה, ולכן אינם בטבלה.'}</div>
      </Panel>
    </>
  );
}
