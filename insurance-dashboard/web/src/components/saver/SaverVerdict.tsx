import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDoor } from '../../lib/door';
import { useMine } from '../../lib/mine';
import { useOptional } from '../../lib/fundsLoad';
import type { DefaultFile } from '../../lib/fundsTools';
import type { FundX, FundsFile } from '../../lib/funds';
import { verdictOf } from '../../lib/verdict';
import { DECISION_PATH, type DecisionFile } from '../../lib/decision';  // W2
import { figsOf } from './figs';
import { Report } from './Report';
import { GlossBar } from './Gloss';
import '../../styles/saver.css';

/** The top of the fund card for the saver door (plan Exhibit 5, /funds/:k): the report card in plain words and the way to "המוצרים שלי"
 *  for the shekels and the note to the agent. Renders nothing for the agent and Pro doors. */
export function SaverVerdict({ f, data }: { f: FundX; data: FundsFile }) {
  const [door] = useDoor();
  const [mine, setMine] = useMine();
  const nav = useNavigate();
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service-index line (absent file: the line is left out)
  const my = mine.find((x) => x.k === f.k);
  const v = useMemo(() => (door === 'saver' && dfile !== undefined ? verdictOf(f, data.funds as FundX[], data.asof, dfile, my, dec) : null), [door, f, data, dfile, my, dec]);
  if (door !== 'saver') return null;
  if (!v) return <section className="panel sv-card sv-oncard" aria-busy="true"><div className="sv-wait">טוען את כרטיס הציון…</div></section>;
  const figs = figsOf(f, v, data.asof, data, dec);
  const add = () => { if (!my) setMine([...mine, { k: f.k, added: new Date().toISOString().slice(0, 10) }]); nav(`/my#${f.k}`); };
  return (
    <section className="panel sv-card sv-oncard" aria-label="כרטיס ציון במילים">
      <div className="hd"><h2>במילים פשוטות</h2><div className="aside"><span>נתוני הרשות עד {String(data.asof % 100).padStart(2, '0')}/{String(Math.floor(data.asof / 100)).slice(2)}</span></div></div>
      <Report v={v} figs={figs} />
      <div className="sv-cta">
        <button type="button" className="btn primary" onClick={add}>{my ? 'במוצרים שלי: בשקלים ותסריט לסוכן' : 'זה המסלול שלי: כמה זה עולה בשקלים'}</button>
        <Link className="sv-link" to="/funds/tools/fees">מחשבון דמי ניהול מלא</Link>
      </div>
      <GlossBar />
    </section>
  );
}
