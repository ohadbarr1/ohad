/* C7 · the track sheet (spec §4.6, 4.0 row 20, 10A.2 C7; mockup v3 frame "track sheet"): tap a track name anywhere. Title: the formal
   name with the column's colour; sub "מס׳ קופה 2102 · פנסיה מקיפה · כללי". Sections: "כמה הרוויח" (the month, year to date, last year,
   3 and 5 years a year, each over "ממוצע הסוג") and "כמה זה עולה" open; "כמה זה עולה ויורד" (equity share, worst and best month in
   5 years, the largest drop), "שירות" (the regulator's service index of the managing company, when published), "גודל", and for the
   agent and Pro doors "למקצוענים". Footer: "☆ זה שלי" (lib/mine), "כרטיס מלא ›" (/funds/<k>), "הסרה" (removes the column).
   Every figure opens its source. Plain words on the saver's sections; the professional terms only under "למקצוענים". */
import { Link } from 'react-router-dom';
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet, SheetSection, SheetSwatch } from '../DeeperSheet';
import { backThen } from '../Sheet';
import { Sourced } from '../Source';
import { useMine } from '../../lib/mine';
import { useOptional } from '../../lib/fundsLoad';
import { DECISION_PATH, SEG_HE, segOf, svcOf, svcProv, type DecisionFile } from '../../lib/decision';
import { actProv } from '../../lib/agentProv';
import { PCT_F, catKey, pc, refOf, retOf, type FundX, type Per } from '../../lib/funds';
import { fundP } from '../../lib/market';
import { MAX_DROP, monthShortYear } from '../../lib/compareWords';
import { nf } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { Fig, Plain, catWin, catWinProv, extremes, monthProv, useCmpData, winProv, type Col } from './sheetKit';

const TILES: [Per, string][] = [['m1', 'החודש'], ['ytd', 'מתחילת השנה'], ['y12', 'שנה אחרונה'], ['a3', '3 שנים, בשנה'], ['a5', '5 שנים, בשנה']];
const EXP = { st: ['STOCK_MARKET_EXPOSURE', 'חשיפה למניות'], fo: ['FOREIGN_EXPOSURE', 'חשיפה לחו"ל'], fx: ['FOREIGN_CURRENCY_EXPOSURE', 'חשיפה למט"ח'] } as const;
const today = () => new Date().toISOString().slice(0, 10);

/** the middle accumulation fee of the category's open tracks (funds.json), and the tracks behind it */
function feeMid(all: FundX[], f: FundX) {
  const xs = all.filter((x) => catKey(x) === catKey(f) && !x.closed && x.fee != null).sort((a, b) => a.fee! - b.fee!);
  if (xs.length < 3) return null;
  const m = xs.length >> 1, v = xs.length % 2 ? xs[m].fee! : (xs[m - 1].fee! + xs[m].fee!) / 2;
  return { v, xs };
}

export function TrackSheet({ keys, basis, door, open, onClose, setKeys, k }: SheetProps & { k: string }) {
  const d = useCmpData(keys, open);
  const dec = useOptional<DecisionFile>(open ? DECISION_PATH : 'funds/decision.json');
  const [mine, setMine] = useMine();
  const c: Col | undefined = d.cols.find((x) => x.k === k);
  const f = c?.f, asof = d.asof ?? 0;
  const own = mine.find((m) => m.k === k);
  const cat = f && d.cats ? d.cats[catKey(f)] ?? null : null, ck = f ? catKey(f) : '';
  const ex = c ? extremes(c.h, basis, asof) : null;
  const mid = f && d.file ? feeMid(d.file.funds as FundX[], f) : null;
  const seg = f ? segOf(f) : null, svc = f && seg && dec ? svcOf(dec, f.grp, seg) : null;
  const basisHe = 'לפני דמי ניהול';
  const remove = () => { const v = keys.filter((x) => x !== k); backThen(() => setKeys(v)); };
  const toggleMine = () => setMine(own ? mine.filter((m) => m.k !== k) : [...mine, { k, added: today() }]);

  const midProv = (): Prov => ({ k: 'calc', title: `דמי ניהול מצבירה, האמצעי בסוג · ${ck}`, value: pc(mid?.v ?? null), formula: 'החציון של דמי הניהול מצבירה (ממוצע בפועל, AVG_ANNUAL_MANAGEMENT_FEE) של המסלולים הפתוחים בסוג', inputs: (mid?.xs ?? []).map((x) => ({ label: x.name, v: pc(x.fee), src: () => fundP(refOf(x), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pc(x.fee)) })) });
  const ddProv = (): Prov => ({ k: 'calc', title: `${MAX_DROP}, 5 שנים · ${f?.name ?? ''}`, value: pc(ex?.dd ?? null, 1), formula: 'הירידה הכי גדולה של ערך החיסכון מהשיא שלפניה, מתוך התשואות החודשיות של 60 החודשים האחרונים בריבית דריבית',
    inputs: ex && c ? [{ label: `השיא שלפני הירידה · סוף ${monthShortYear(ex.ddPeak)}`, v: '', src: () => monthProv(c.f, c.h, ex.ddPeak, basis) }, { label: `השפל · סוף ${monthShortYear(ex.low)}`, v: '', src: () => monthProv(c.f, c.h, ex.low, basis) }] : [] });
  // pr = the gross percentile (0–100); prn = the number of peers behind it (lib/fundsTimeLoad snapOf)
  const pctV = f ? f.pr?.a5 ?? null : null, pctN = f ? f.prn?.a5 ?? null : null;
  const pctProv = (): Prov => ({ k: 'calc', title: `אחוזון 5Y בקטגוריה · ${f?.name ?? ''}`, value: pctV == null ? '–' : nf(pctV, 0), formula: d.file && (d.file as { pr_method?: string }).pr_method || PCT_F,
    inputs: f ? [{ label: 'תשואה שנתית ממוצעת, 5Y', v: pc(retOf(f, 'a5', basis).v, 1), src: () => winProv(f, 'a5', basis, asof, d.file) }, ...(pctN != null ? [{ label: 'מסלולים מדורגים', v: String(pctN) }] : [])] : [] });

  return (
    <DeeperSheet open={open} onClose={onClose} id="track-sheet-dlg" lead={c ? <SheetSwatch color={c.color} /> : undefined}
      title={f?.name ?? (d.file ? 'המסלול לא נמצא' : '…')}
      sub={f ? `מס׳ קופה ${f.id} · ${f.prod} · ${f.track}${f.closed || f.gone ? ' · נסגר' : ''}` : undefined}
      footer={<div className="cs-nav three">
        <button type="button" className="cs-btn" aria-pressed={!!own} onClick={toggleMine}>{own ? '★ שלי' : '☆ זה שלי'}</button>
        <Link className="cs-btn" to={`/funds/${k}`}>כרטיס מלא ›</Link>
        <button type="button" className="cs-btn rm" id="track-remove" onClick={remove}>הסרה</button>
      </div>}>
      {!f ? <div className="cs-skel" /> : (
        <div id="track-sheet">
          <SheetSection title="כמה הרוויח" open>
            <div className="ts-tiles">
              {TILES.map(([per, l]) => {
                const v = retOf(f, per, basis).v, dd = per === 'm1' ? 2 : 1, a = catWin(cat, per, asof, basis);
                return (
                  <div className="ts-tile" key={per}>
                    <small>{l}</small>
                    <Fig v={v} d={dd} className="big" src={() => winProv(f, per, basis, asof, d.file)} />
                    {cat ? <><em>ממוצע הסוג</em><Fig v={a} d={dd} tone={false} className="avg" src={() => catWinProv(ck, cat, per, asof, basis)} /></> : null}
                  </div>
                );
              })}
            </div>
            <p className="cs-note">{basisHe}. {f.a5 == null ? 'אין עדיין 5 שנים של נתונים.' : ''}</p>
          </SheetSection>
          <SheetSection title="כמה זה עולה" open>
            <dl className="ts-dl">
              <dt>דמי ניהול מהחיסכון, בשנה</dt>
              <dd><Plain v={f.fee} src={() => fundP(refOf(f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pc(f.fee))} className="b" />
                {mid ? <small> האמצעי בסוג הזה <Plain v={mid.v} src={midProv} /></small> : null}</dd>
              {f.depfee != null ? <><dt>דמי ניהול מכל הפקדה</dt><dd><Plain v={f.depfee} className="b" src={() => fundP(refOf(f), asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pc(f.depfee))} /></dd></> : null}
              {own?.fee != null ? <><dt>דמי הניהול שלך, לפי הדוח שלך</dt><dd><bdi dir="ltr" className="n b">{nf(own.fee, 2)}%</bdi>{own.depfee != null ? <small> · מכל הפקדה <bdi dir="ltr" className="n">{nf(own.depfee, 2)}%</bdi></small> : null}</dd></> : null}
            </dl>
            <p className="cs-note">ממוצע בפועל של כל החוסכים במסלול. דמי הניהול שלך כתובים בדוח השנתי.</p>
          </SheetSection>
          <SheetSection title="כמה זה עולה ויורד">
            <dl className="ts-dl">
              <dt>מניות</dt>
              <dd>{f.st == null ? '–' : <Sourced src={() => fundP(refOf(f), asof, EXP.st[0], EXP.st[1], `${nf(f.st!, 0)}%`)} className="n b">{`${nf(f.st!, 0)}%`}</Sourced>}</dd>
              {ex ? <>
                <dt>החודש הכי גרוע ב-5 שנים</dt>
                <dd><Fig v={ex.worst.v} d={2} className="b" src={() => monthProv(f, c!.h, ex.worst.p, basis)} /> <small>{monthShortYear(ex.worst.p)}</small></dd>
                <dt>החודש הכי טוב ב-5 שנים</dt>
                <dd><Fig v={ex.best.v} d={2} className="b" src={() => monthProv(f, c!.h, ex.best.p, basis)} /> <small>{monthShortYear(ex.best.p)}</small></dd>
                <dt>{MAX_DROP}</dt>
                <dd><Fig v={ex.dd} d={1} className="b" src={ddProv} /> <small>שפל {monthShortYear(ex.low)}</small></dd>
              </> : <><dt>5 שנים</dt><dd>{c?.h ? 'אין עדיין' : '…'}</dd></>}
            </dl>
            {ex ? <p className="cs-note">{basisHe}, מ{monthShortYear(ex.from)} עד {monthShortYear(asof)}.</p> : null}
          </SheetSection>
          {svc && seg && dec ? (
            <SheetSection title="שירות">
              <dl className="ts-dl">
                <dt>מדד השירות של רשות שוק ההון, {svc.year}</dt>
                <dd><Sourced src={() => svcProv(dec, f.grp, seg, 'total')} className="n b">{String(svc.total)}</Sourced> <small>מתוך 100 · <Sourced src={() => svcProv(dec, f.grp, seg, 'rank')}>{`מקום ${svc.rank} מתוך ${svc.of}`}</Sourced></small></dd>
              </dl>
              <p className="cs-note">הציון של החברה המנהלת ב{SEG_HE[seg]}: שביעות רצון, תלונות, מענה טלפוני.</p>
            </SheetSection>
          ) : null}
          <SheetSection title="גודל">
            <dl className="ts-dl">
              <dt>נכסים במסלול</dt>
              <dd>{f.assets == null ? '–' : <><Sourced src={() => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', `${nf(f.assets!, 0)}`, 'מיליוני ש"ח')} className="n b">{nf(f.assets / 1000, 1)}</Sourced> <small>מיליארד ש״ח</small></>}</dd>
            </dl>
          </SheetSection>
          {door !== 'saver' ? (
            <SheetSection title="למקצוענים">
              <dl className="ts-dl">
                <dt>שארפ (כפי שפורסם)</dt>
                <dd>{f.sharpe == null ? '–' : <Sourced src={() => fundP(refOf(f), asof, 'SHARPE_RATIO', 'שארפ', nf(f.sharpe!, 2))} className="n b">{nf(f.sharpe!, 2)}</Sourced>}</dd>
                <dt>סטיית תקן</dt>
                <dd>{f.sd == null ? '–' : <Sourced src={() => fundP(refOf(f), asof, 'STANDARD_DEVIATION', 'סטיית תקן', `${nf(f.sd!, 2)}%`)} className="n b">{`${nf(f.sd!, 2)}%`}</Sourced>}</dd>
                <dt>חו״ל / מט״ח</dt>
                <dd>{f.fo == null ? '–' : <Sourced src={() => fundP(refOf(f), asof, EXP.fo[0], EXP.fo[1], `${nf(f.fo!, 0)}%`)} className="n b">{`${nf(f.fo!, 0)}%`}</Sourced>}{' / '}{f.fx == null ? '–' : <Sourced src={() => fundP(refOf(f), asof, EXP.fx[0], EXP.fx[1], `${nf(f.fx!, 0)}%`)} className="n b">{`${nf(f.fx!, 0)}%`}</Sourced>}</dd>
                <dt>אחוזון 5Y בקטגוריה</dt>
                <dd>{pctV == null ? '–' : <Sourced src={pctProv} className="n b">{nf(pctV, 0)}</Sourced>}{pctN != null ? <small> מתוך {pctN}</small> : null}</dd>
                {f.act != null ? <><dt>איזון אקטוארי</dt><dd><Sourced src={() => actProv(f)} className="n b">{`${nf(f.act, 2)}%`}</Sourced>{f.act_p ? <small> {monthShortYear(f.act_p)}</small> : null}</dd></> : null}
              </dl>
            </SheetSection>
          ) : null}
        </div>
      )}
    </DeeperSheet>
  );
}
