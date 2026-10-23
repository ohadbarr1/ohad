/* /facts/:id — one primary statement read from the fact table (data/facts/<id>.json), with the vintage toggle: every cell as the site
   shows it today, as first reported, or as known on the day of any report; a dot marks a cell whose first print differs, and opens both
   pages. The page exists to verify the fact table and the toggle before they move into the company statements. */
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Sourced } from '../components/Source';
import { countChanged, useVintage, VintageMark, VintageToggle, vintageProv } from '../components/VintageToggle';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { fmtCell, nf, pubLabel } from '../lib/format';
import { FL, useTaxonomy, type Facts, type Line } from '../lib/facts';
import { idCss } from '../lib/identity';
import { usePhone } from '../lib/useMedia';
import { useRegistry } from '../lib/useData';
import { NotFound } from './NotFound';
import '../styles/facts.css';

type St = 'pl' | 'bs' | 'oci' | 'cf';
const SHEET: Record<St, string> = { pl: 'X.רווח_והפסד', bs: 'X.מאזן', oci: 'X.רווח_כולל', cf: 'X.תזרים_מזומנים' };
const ST_OPTS: [St, string][] = [['pl', 'רווח והפסד'], ['bs', 'מאזן'], ['oci', 'רווח כולל'], ['cf', 'תזרים מזומנים']];
const WIN_HE: Record<string, string> = { Q: 'רבעון', H: 'חצי שנה', FY: 'שנה', I: 'יתרה' };
const TIER_HE: Record<string, string> = { core: 'שורת ליבה', shared: 'שורה משותפת לחברות', own: 'שורה של החברה בלבד' };

export function FactsPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const reg = useRegistry();
  const entry = reg.data?.find((c) => c.id === id);
  const { policy, setPolicy, facts, error } = useVintage(id, { want: true });
  const tax = useTaxonomy();
  const phone = usePhone();
  const st = (ST_OPTS.some(([k]) => k === sp.get('s')) ? sp.get('s') : 'pl') as St;
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  if (reg.data && !entry) return <NotFound />;
  if (error) return <ErrorBox what="טבלת העובדות" error={error.includes('404') ? 'לחברה הזו אין עדיין טבלת עובדות' : error} />;
  if (!facts) return <Loading what="טבלת העובדות" />;
  return <Statement facts={facts} st={st} set={set} sp={sp} policy={policy} setPolicy={setPolicy} tax={tax} phone={phone} name={entry?.name_he ?? facts.d.name} id={id} />;
}

function Statement({ facts, st, set, sp, policy, setPolicy, tax, phone, name, id }: {
  facts: Facts; st: St; set: (k: string, v: string) => void; sp: URLSearchParams; policy: ReturnType<typeof useVintage>['policy']; setPolicy: ReturnType<typeof useVintage>['setPolicy'];
  tax: ReturnType<typeof useTaxonomy>; phone: boolean; name: string; id: string;
}) {
  const all = useMemo(() => facts.lines.filter((l) => l.sheet === SHEET[st]), [facts, st]);
  const stds = useMemo(() => (['17', '4'] as const).filter((s) => all.some((l) => l.std === s)), [all]);
  const std = (stds.find((s) => s === sp.get('std')) ?? stds[0] ?? '') as '17' | '4' | '';
  const lines = useMemo(() => all.filter((l) => !std || l.std === std), [all, std]);
  // windows the statement prints: quarters, half-years, years (flows) or balance dates
  const wins = useMemo(() => {
    const have = new Set<string>();
    lines.forEach((l) => { for (let k = l.start; k < l.end; k++) have.add(facts.period(facts.d.rows.p[k])[0]); });
    return ['Q', 'H', 'FY', 'I'].filter((w) => have.has(w));
  }, [facts, lines]);
  const win = wins.includes(sp.get('w') ?? '') ? sp.get('w')! : wins[0] ?? 'Q';
  const nCols = phone ? 6 : 8;  // the phone scrolls the table sideways inside its panel
  // the latest periods of the window that the statement prints, newest first
  const cols = useMemo(() => {
    const ps = new Set<number>();
    lines.forEach((l) => { for (let k = l.start; k < l.end; k++) { const p = facts.d.rows.p[k]; if (facts.period(p)[0] === win) ps.add(p); } });
    return [...ps].sort((a, b) => b - a).slice(0, nCols);
  }, [facts, lines, win, nCols]);
  const shown = useMemo(() => lines.filter((l) => cols.some((p) => facts.cell(l, p, policy) || facts.cell(l, p, 'latest'))), [facts, lines, cols, policy]);
  const changed = useMemo(() => countChanged(facts, shown, cols), [facts, shown, cols]);
  // reports to read the statement as of: every vintage that printed a figure of it, newest first
  const vintages = useMemo(() => {
    const ts = new Set<number>();
    lines.forEach((l) => { for (let k = l.start; k < l.end; k++) ts.add(facts.d.rows.t[k]); });
    return [...ts].filter((t) => facts.vint[t].pub).sort((a, b) => facts.vdate(b).localeCompare(facts.vdate(a))).map((t) => [facts.vdate(t), facts.vlabel(t)] as [string, string]);
  }, [facts, lines]);
  const reprinted = useMemo(() => { let n = 0; shown.forEach((l) => cols.forEach((p) => { if (facts.prints(l, p).length > 1) n++; })); return n; }, [facts, shown, cols]);
  const block = (l: Line) => (tax?.lines[l.id.split('~')[0]]?.[2] ?? '');
  const blockHe = (b: string) => tax?.block[b] ?? '';

  const cell = (l: Line, p: number) => {
    const c = facts.cell(l, p, policy);
    if (!c) return <td key={p}><span className="num muted">–</span></td>;
    const txt = fmtCell(c.v, l.unit, 'm');
    const cls = `num${c.f & FL.DER ? ' der' : ''}${c.f & FL.IFRS4 ? ' old' : ''}`;
    return (
      <td key={p}>
        <span className="fx-cell">
          <VintageMark facts={facts} line={l} p={p} policy={policy} />
          <Sourced src={() => vintageProv(facts, l, p, policy, 'm')!} href={facts.pdf(c)} title={`${facts.vlabel(c.t)}${c.pg ? `, עמ׳ ${c.pg}` : ''}`}><span className={cls}>{txt}</span></Sourced>
        </span>
      </td>
    );
  };

  let lastBlock = '';
  return (
    <div className="fx">
      <header className="fx-head">
        <h1><span className="fx-co" style={{ color: idCss(id) }}>{name}</span> · עובדות</h1>
        <p className="muted">כל נתון עם כל דוח שהדפיס אותו · <Link to={`/company/${id}/financials`}>הדוחות הכספיים</Link></p>
      </header>
      <div className="fx-bar">
        <Seg value={st} options={ST_OPTS} onChange={(v) => set('s', v === 'pl' ? '' : v)} label="דוח" />
        {stds.length > 1 && <Seg value={std as '17' | '4'} options={stds.map((s) => [s, `IFRS ${s}`] as ['17' | '4', string])} onChange={(v) => set('std', v === stds[0] ? '' : v)} label="תקן" />}
        {wins.length > 1 && <Seg value={win} options={wins.map((w) => [w, WIN_HE[w]] as [string, string])} onChange={(v) => set('w', v === wins[0] ? '' : v)} label="חלון" />}
        <VintageToggle value={policy} onChange={setPolicy} changed={changed} vintages={vintages} />
      </div>
      <Panel title={`${ST_OPTS.find(([k]) => k === st)![1]}${std ? ` · IFRS ${std}` : ''}`} aside={<span>מיליוני ש"ח · <span className="num">{nf(reprinted, 0)}</span> תאים הודפסו ביותר מדוח אחד · נטוי = מחושב · כל ערך מקושר לעמוד</span>}>
        {!shown.length ? <Empty title="אין נתונים בחלון הזה" /> : (
          <div className="scroll">
            <table className="fx-table">
              <thead><tr><th>שורה</th>{cols.map((p) => <th key={p}>{facts.plabel(p)}</th>)}</tr></thead>
              <tbody>
                {shown.flatMap((l) => {
                  const b = block(l), out = [];
                  if (b && b !== lastBlock && blockHe(b)) out.push(<tr key={`b${l.i}`} className="sec"><td colSpan={cols.length + 1}>{blockHe(b)}</td></tr>);
                  lastBlock = b || lastBlock;
                  const t = tax?.lines[l.id.split('~')[0]];
                  out.push(
                    <tr key={l.i}>
                      <td className="lbl"><div className="fx-lbl"><span title={l.label}>{l.label}</span><code className={`fx-id ${t?.[3] ?? 'own'}`} title={`${TIER_HE[t?.[3] ?? 'own']}${t && t[10] > 1 ? ` · ${t[10]} חברות` : ''}`}>{l.id}</code></div></td>
                      {cols.map((p) => cell(l, p))}
                    </tr>,
                  );
                  return out;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="fx-foot muted">
        {policy === 'latest' ? 'מעודכן: ההדפסה האחרונה של כל תקופה (הערך שבאתר).' : policy === 'original' ? 'כפי שדווח לראשונה: כל תקופה מהדוח הראשון שהדפיס אותה.' : `נכון לדוח: מה שפורסם עד ${vintages.find(([d]) => d === policy.slice(5))?.[1] ?? pubLabel(policy.slice(5))}; רבעון רביעי מחושב באותה גרסה.`}
        {' '}נקודה = ההדפסה הראשונה שונה מהמעודכן; לחיצה פותחת את שני העמודים.
      </p>
    </div>
  );
}
