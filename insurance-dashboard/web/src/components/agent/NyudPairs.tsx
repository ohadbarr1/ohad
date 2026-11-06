import { useEffect, useState } from 'react';
import { COEF_LOSS, KIND_HE, tenderPreset, type Candidate, type FeeOverride, type NyudPairs, type NyudRow, type PairSlot } from '../../lib/nyud';
import { nf } from '../../lib/format';

/* red team 06.11.26 · the per-product pairing of the wizard's step 2 (/clients/new): each existing product of the client against at
   most one proposed track, chosen product by product (lib/nyud nyudTable `slots`). A product of the same kind is suggested
   automatically; a managers' policy, a closed track and a product with a guaranteed coefficient wait for the agent; a guaranteed
   coefficient also needs the confirmation "מקדם מובטח יאבד". Under each pair: the fee agreed with the client (the tender price is a
   labelled preset), and the proposed product's cover cost a month when the pair is not comparable without it. */

const pc = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);
const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const num = (s: string) => { const v = s.trim() === '' ? NaN : Number(s.replace(',', '.')); return Number.isFinite(v) ? v : null; };

/** two inputs (from deposits, from savings) that commit only a valid pair; empty clears the agreed fee */
function FeeInputs({ id, ov, cand, onSet }: { id: string; ov: FeeOverride | null; cand: Candidate; onSet: (v: FeeOverride | null) => void }) {
  const [d, setD] = useState(ov ? String(ov.depfee) : '');
  const [a, setA] = useState(ov ? String(ov.fee) : '');
  useEffect(() => { setD(ov ? String(ov.depfee) : ''); setA(ov ? String(ov.fee) : ''); }, [ov?.depfee, ov?.fee, ov?.src]);  // eslint-disable-line react-hooks/exhaustive-deps
  const tp = tenderPreset(cand);
  const commit = (ds: string, as: string) => {
    if (!ds.trim() && !as.trim()) { onSet(null); return; }
    const dv = num(ds), av = num(as);
    if (dv != null && av != null && dv >= 0 && dv <= 10 && av >= 0 && av <= 5) onSet({ depfee: dv, fee: av, src: 'agreed' });
  };
  const bad = (d.trim() || a.trim()) && !(num(d) != null && num(a) != null && num(d)! <= 10 && num(a)! <= 5 && num(d)! >= 0 && num(a)! >= 0);
  return (
    <div className="np-fee" role="group" aria-label={`דמי ניהול שסוכמו: ${cand.name}`}>
      <span className="np-lbl">דמי ניהול שסוכמו</span>
      <label>מהפקדה % <input id={`${id}-d`} type="text" inputMode="decimal" value={d} onChange={(e) => { setD(e.target.value); commit(e.target.value, a); }} placeholder="להזנה" /></label>
      <label>מצבירה % <input id={`${id}-a`} type="text" inputMode="decimal" value={a} onChange={(e) => { setA(e.target.value); commit(d, e.target.value); }} placeholder="להזנה" /></label>
      {tp && <button type="button" className="chip" aria-pressed={ov?.src === 'tender'} onClick={() => onSet(ov?.src === 'tender' ? null : tp)}>מחיר המכרז ({pc(tp.depfee)} / {pc(tp.fee)}, הנחה)</button>}
      <span className="np-note">{ov?.src === 'agreed' ? 'במסמך: "שסוכמו"' : ov?.src === 'tender' ? 'במסמך: מחיר המכרז, מסומן "הנחה" (מובטח למצטרף דרך ההליך, לא בהכרח ללקוח של סוכן)' : `לא הוזן: במסמך הממוצע בפועל של המסלול (${pc(cand.depfee)} / ${pc(cand.fee)}), מסומן "הנחה"`}</span>
      {bad && <span className="np-err" role="alert">שני שיעורים: מהפקדה עד 10%, מצבירה עד 5%</span>}
    </div>
  );
}

function CoverInput({ id, v, onSet }: { id: string; v: number | null; onSet: (v: number | null) => void }) {
  const [t, setT] = useState(v != null ? String(v) : '');
  return (
    <label className="np-cov" htmlFor={id}>עלות הביטוח במוצר המוצע, ₪ לחודש (מהגוף המנהל)
      <input id={id} type="text" inputMode="decimal" value={t} onChange={(e) => { setT(e.target.value); const x = num(e.target.value); onSet(e.target.value.trim() === '' ? null : x != null && x >= 0 ? x : null); }} placeholder="להשלים" />
    </label>
  );
}

export function NyudPairsPick({ slots, rows, pairs, onPairs }: { slots: PairSlot[]; rows: NyudRow[]; pairs: NyudPairs; onPairs: (p: NyudPairs) => void }) {
  if (!slots.length) return null;
  const set = <K extends keyof NyudPairs>(k: K, i: number, v: NonNullable<NyudPairs[K]>[string] | null) => {
    const m = { ...(pairs[k] ?? {}) } as Record<string, unknown>;
    if (v == null || v === false) delete m[String(i)]; else m[String(i)] = v;
    onPairs({ ...pairs, [k]: m });
  };
  return (
    <div className="np" aria-labelledby="np-h">
      <h3 id="np-h">זוגות הניוד: מוצר מול מוצר</h3>
      <p className="wiz-note">כל מוצר קיים מול מסלול מוצע אחד מאותו סוג (פנסיה מול פנסיה, גמל מול גמל, השתלמות מול השתלמות). ביטוח מנהלים, מסלול סגור ומוצר עם מקדם מובטח אינם מוצמדים אוטומטית.</p>
      <ul className="np-l">{slots.map((s) => {
        const row = rows.find((r) => r.i === s.i);
        const cand = s.pick ? s.options.find((o) => o.k === s.pick) ?? null : null;
        const coef = s.h.coefGuaranteed?.v;
        return (
          <li key={s.i} className={s.included ? 'on' : undefined}>
            <div className="np-h"><b>{s.name}</b><span className="np-sub">{KIND_HE[s.kind]}{s.h.track ? ` · ${s.h.track}` : ''} · יתרה {ils(s.h.balance)}{s.h.monthly == null ? ' · אין הפקדה בקובץ' : ` · הפקדה ${ils(s.h.monthly)}`}</span></div>
            <label className="np-pick">מסלול מוצע
              <select value={s.pick ?? '-'} onChange={(e) => set('pick', s.i, e.target.value)} disabled={!s.options.length}>
                <option value="-">בלי ניוד</option>
                {s.options.map((o) => <option key={o.k} value={o.k}>{o.name}</option>)}
              </select>
              {s.auto && <span className="tag">הוצמד אוטומטית: אותו סוג מוצר</span>}
            </label>
            {!s.pick && s.block && <span className="np-note">{s.block}</span>}
            {!s.options.length && !s.block && <span className="np-note">אין בין המסלולים המוצעים מסלול שאפשר לנייד אליו את המוצר הזה</span>}
            {s.needOk && coef != null && <label className="np-ok"><input type="checkbox" checked={s.ok} onChange={(e) => set('ok', s.i, e.target.checked)} /> {COEF_LOSS(coef)}: מאשר/ת לכלול את הזוג במסמך</label>}
            {s.included && cand && <FeeInputs id={`np${s.i}`} ov={pairs.fee?.[String(s.i)] ?? null} cand={cand} onSet={(v) => set('fee', s.i, v)} />}
            {row && (row.incomplete || row.cover.agent) && <CoverInput id={`npc${s.i}`} v={pairs.cover?.[String(s.i)] ?? null} onSet={(v) => set('cover', s.i, v)} />}
          </li>);
      })}</ul>
    </div>
  );
}
