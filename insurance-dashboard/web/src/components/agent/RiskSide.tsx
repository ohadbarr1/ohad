import { useRef, useState } from 'react';
import { Sourced } from '../Source';
import { useOptional } from '../../lib/fundsLoad';
import { upsert, useClients, type Folder } from '../../lib/clients';
import { COVERS_PATH, SEX_HE, rawProv, type CoversFile, type CSex } from '../../lib/coverPrice';
import { HARB_ACCEPT, HARB_WARN, heldFromHarb, readHarb } from '../../lib/harb';
import { CAT_HE, confirmPer, riskOf, shortIns, withHarb, type RiskFlag } from '../../lib/harbRisk';
import { F } from '../../lib/wizard';
import { today } from '../../lib/visits';
import '../../styles/agentRisk.css';

/* fox 3.0 A6 · "צד הסיכון" in a client folder (/clients): the policies from the client's הר הביטוח file (lib/harb), the flags an
   agent checks in a meeting (same cover twice, partial overlaps, private cover next to the pension fund's, policies ending), and per
   company the premium a month next to the pension-fund bylaws price of disability + survivors cover where fox has it
   (funds/covers.json). The file is read in this browser and only the policy records are kept in the folder (lib/harbTypes: no ID,
   no name, no full policy number). A folder without the file shows how to get it and a file picker. */

const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const n2 = (v: number | null | undefined) => (v == null ? '–' : `₪${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('.') : '–');
const SEV_HE: Record<RiskFlag['sev'], string> = { high: 'לבדיקה ראשונה', mid: 'לבדיקה', info: 'לידיעה' };
export const HARB_HOW = 'הלקוח נכנס להר הביטוח בהזדהות הממשלתית ומוריד משם את רשימת הפוליסות שלו לקובץ Excel.';

/** a picker that reads a הר הביטוח file and adds its policies to a folder (the policies of an earlier read are replaced) */
function HarbPick({ f, label }: { f: Folder; label: string }) {
  const [file, setFile] = useClients();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const run = async (x: File | undefined) => {
    if (!x) return;
    setBusy(true); setMsg(null);
    try {
      if (x.size > 10_000_000) throw new Error('הקובץ גדול מדי לרשימת פוליסות');
      const r = await readHarb(new Uint8Array(await x.arrayBuffer()));
      if (!r.rows.length) throw new Error(r.warn.filter((w) => w !== HARB_WARN).join(' · ') || 'לא נמצאו פוליסות בקובץ');
      const fresh = heldFromHarb(r.rows, r.asof ?? today());
      const cur = file.folders.find((y) => y.id === f.id) ?? f;
      const out = upsert(file, { id: cur.id, label: cur.label, keys: cur.keys, held: withHarb(cur.held, fresh) }, today());
      setFile(out.file);
      setMsg({ ok: true, t: `נקראו ${fresh.length} פוליסות מהר הביטוח${r.asof ? `, נכון ל-${dmy(r.asof)}` : ''}. הקובץ עצמו לא נשמר.${r.warn.length > 1 ? ` ${r.warn.filter((w) => w !== HARB_WARN).join(' · ')}` : ''}` });
    } catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); if (inp.current) inp.current.value = ''; }
  };
  return (
    <div className="rk-pick">
      <label className="chip rk-file">{busy ? 'קורא…' : label}<input ref={inp} type="file" accept={HARB_ACCEPT} onChange={(e) => void run(e.target.files?.[0])} /></label>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rk-msg' : 'ci-err'}>{msg.t}</p>}
    </div>
  );
}

export function RiskSide({ f }: { f: Folder }) {
  const cov = useOptional<CoversFile>(COVERS_PATH);
  const [file, setFile] = useClients();
  // red team 06.11.26: the agent confirms the period of a "monthly" premium that looks annual
  const confirm = (i: number, per: 'month' | 'year') => { const cur = file.folders.find((y) => y.id === f.id) ?? f; setFile(upsert(file, { id: cur.id, label: cur.label, keys: cur.keys, held: confirmPer(cur.held, i, per) }, today()).file); };
  const ageN = Number(f.fields[F.age]);
  const sexF = f.fields[F.sex];
  const out = riskOf(f.held, today(), { cov, age: Number.isFinite(ageN) && ageN >= 16 && ageN <= 80 ? ageN : null, sex: sexF === 'm' || sexF === 'f' ? sexF as CSex : null });
  if (!out.rows.length) return (
    <div className="rk rk-empty">
      <p><b>צד הסיכון:</b> עוד לא נטען קובץ מהר הביטוח (בריאות, חיים, אובדן כושר עבודה, רכב ודירה). {HARB_HOW} <a className="rk-u" href="https://harb.cma.gov.il/" target="_blank" rel="noopener noreferrer">הר הביטוח</a></p>
      <HarbPick f={f} label="הוספת קובץ מהר הביטוח" />
    </div>
  );
  const asof = out.rows[0].h.asof;
  const high = out.flags.filter((x) => x.sev === 'high').length;
  const withPrice = out.companies.filter((c) => c.fund && c.cell);
  return (
    <details className="rk cl-held">
      <summary>צד הסיכון: {out.rows.length} פוליסות מהר הביטוח · {ils(out.monthly)} לחודש{out.flags.length ? ` · ${out.flags.length} נקודות לבדיקה${high ? ` (${high} כפל אפשרי)` : ''}` : ''}{asof ? ` · נכון ל-${dmy(asof)}` : ''}</summary>
      {out.flags.length > 0 && <ul className="rk-flags" aria-label="נקודות לבדיקה בצד הסיכון">
        {out.flags.map((x, i) => <li key={i} className={`rk-f ${x.sev}`}><span className="rk-sev">{SEV_HE[x.sev]}</span><b>{x.title}</b><span>{x.text}</span></li>)}
      </ul>}
      <div className="scroll"><table className="fsimple rk-t">
        <caption className="sr-only">הפוליסות מהר הביטוח</caption>
        <thead><tr><th scope="col">חברה</th><th scope="col">כיסוי</th><th scope="col">סוג</th><th scope="col">תקופה</th><th scope="col">פרמיה לחודש</th><th scope="col">פוליסה</th></tr></thead>
        <tbody>{out.rows.map((x) => { const r = x.r; return (
          <tr key={x.i} className={x.active ? undefined : 'rk-ended'}>
            <th scope="row">{shortIns(x.h.provider)}{out.people > 1 && r.who != null && <span className="ci-sub">מבוטח {r.who}</span>}</th>
            <td>{(() => { const name = x.h.covers[0]?.name ?? x.h.typeHe, cat = r.cats.map((c) => CAT_HE[c]).join(' + ');
              const sub = [r.sub && r.sub !== name ? r.sub : r.main && r.main !== name ? r.main : null, name.includes(cat) ? null : cat].filter(Boolean).join(' · ');
              return <><b>{name}</b>{sub && <span className="ci-sub">{sub}</span>}</>; })()}</td>
            <td>{[r.ptype, r.group == null ? null : r.group ? 'קבוצתי' : 'אישי'].filter(Boolean).join(' · ') || '–'}</td>
            <td><span className="num">{dmy(r.start)}</span>{r.end && <> עד <span className="num">{dmy(r.end)}</span></>}{!x.active && <span className="ci-sub">הסתיימה לפי הקובץ</span>}</td>
            <td>{r.perDoubt ? <><span className="num">{n2(r.premium)}</span><span className="ci-sub rk-doubt">ייתכן שזו פרמיה שנתית · לא בסכום</span>
              <span className="rk-per"><button type="button" className="chip" onClick={() => confirm(x.i, 'year')}>שנתית</button><button type="button" className="chip" onClick={() => confirm(x.i, 'month')}>חודשית</button></span></>
              : x.monthly != null ? <span className="num">{n2(x.monthly)}</span> : r.premium != null ? <><span className="num">{n2(r.premium)}</span><span className="ci-sub">לא צוין אם חודשית או שנתית</span></> : '–'}{r.per === 'year' && !r.perDoubt && <span className="ci-sub">שנתית {ils(r.premium)}, חולקה ב-12</span>}</td>
            <td><span className="num">{r.pol ?? '–'}</span></td>
          </tr>); })}</tbody>
        <tfoot><tr><th scope="row" colSpan={4}>סה"כ לחודש, פוליסות בתוקף{out.rows.some((x) => x.r.cats.includes('lifeSave')) ? ' (בלי ביטוח חיים עם חיסכון)' : ''}</th><td><span className="num">{ils(out.monthly)}</span><span className="ci-sub">{ils(out.annual)} לשנה</span></td><td /></tr></tfoot>
      </table></div>
      {(out.unknownPer > 0 || out.noPremium > 0 || out.doubt > 0) && <p className="cl-note">{[out.doubt ? `${out.doubt === 1 ? 'פוליסה אחת' : `${out.doubt} פוליסות`} עם פרמיה "חודשית" שנראית שנתית (מסומנות בטבלה: לאשר שנתית או חודשית)` : null, out.unknownPer ? `${out.unknownPer} פוליסות עם פרמיה שהקובץ לא אומר אם היא חודשית או שנתית` : null, out.noPremium ? `${out.noPremium} בלי פרמיה בקובץ` : null].filter(Boolean).join('; ')}: לא נכנסו לסכום.</p>}
      <h4 className="rk-h">לפי חברה{withPrice.length ? ': הפרמיה ומחיר הכיסוי בקרן הפנסיה של הקבוצה' : ''}</h4>
      <div className="scroll"><table className="fsimple rk-t rk-co">
        <caption className="sr-only">צד הסיכון לפי חברה, עם מחיר כיסוי הנכות והשאירים בקרן הפנסיה לפי התקנון</caption>
        <thead><tr><th scope="col">חברה</th><th scope="col">פוליסות בתוקף</th><th scope="col">פרמיה לחודש</th><th scope="col">נכות + שאירים בקרן הפנסיה, ₪ לחודש לכל ₪1,000 שכר מבוטח ({out.sex ? SEX_HE[out.sex] : 'גבר / אישה'}, גיל {out.age})</th></tr></thead>
        <tbody>{out.companies.map((c) => (
          <tr key={c.name}>
            <th scope="row">{c.name}{c.pension && <span className="ci-sub">קרן הפנסיה של הלקוח</span>}</th>
            <td><span className="num">{c.n || '–'}</span></td>
            <td><span className="num">{ils(c.monthly)}</span>{c.unknown > 0 && <span className="ci-sub">ועוד {c.unknown} בלי תקופת תשלום</span>}</td>
            <td>{cov && c.fund && c.cell?.total != null ? <>
              <Sourced src={() => rawProv(cov, c.fund!, c.cell!)}>{n2(c.cell.total)}</Sourced>
              {c.cellF?.total != null && <> / <Sourced src={() => rawProv(cov, c.fund!, c.cellF!)}>{n2(c.cellF.total)}</Sourced></>}
              <span className="ci-sub">{c.fund.src.fund ?? c.fund.grp}</span>
            </> : <span className="ci-sub">{cov === undefined ? 'טוען…' : 'אין ב-fox טבלת תקנון לקבוצה'}</span>}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="cl-note">
        {withPrice.length ? `המחיר מטבלאות התקנון של קרן הפנסיה המקיפה של הקבוצה, למבוטח סטנדרטי במסלול ברירת המחדל${out.ageFromFolder ? '' : ' (גיל 40: לא צוין גיל בתיק)'}; ${out.sex ? '' : 'בלי מין בתיק מוצגים גבר / אישה; '}זה מחיר הכיסוי בתוך הקרן, להשוואה לעלות כיסוי פרטי, לא הצעת מחיר. `
          : ''}
        הנתונים מהקובץ שהלקוח הוריד מהר הביטוח (רשות שוק ההון), בלי תנאי הפוליסות, סכומי הביטוח והחרגות: הנקודות לבדיקה הן הפניה לבדוק, לא קביעה. {HARB_WARN}. נשמרים בתיק רק החברה, הענף, התקופה, הפרמיה וארבע הספרות האחרונות של מספר הפוליסה.
      </p>
      <HarbPick f={f} label="קובץ חדש מהר הביטוח (מחליף את הקודם)" />
    </details>
  );
}
