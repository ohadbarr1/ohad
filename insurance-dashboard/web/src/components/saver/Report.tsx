import { Link } from 'react-router-dom';
import type { Prov } from '../../lib/prov';
import { Tip } from '../Explain';
import { headline, type Fig, type Verdict } from '../../lib/verdict';
import { Parts } from './figs';

const TIP: Record<string, string> = { ret: 'net', rank: 'cat', fee: 'fee', dflt: 'dflt', dep: 'depfee' };
const TONE_HE: Record<string, string> = { good: 'לטובה', bad: 'לרעה', mid: 'באמצע', info: 'מידע' };

/** The report card's body: a headline, up to four tiles in plain words, and the verdict lines. Descriptive only. */
export function Report({ v, figs }: { v: Verdict; figs: Record<Fig, () => Prov> }) {
  const h = headline(v);
  return (
    <div className="sv-report">
      {h && <p className="sv-head">{h}</p>}
      {v.tiles.length > 0 && <div className="sv-tiles">
        {v.tiles.map((t) => (
          <div key={t.key} className={`sv-tile t-${t.tone}`}>
            <div className="sv-tile-l">{t.label}<Tip k={TIP[t.key]} /></div>
            <div className="sv-tile-v">{typeof t.value === 'string' ? t.value : <Parts parts={[t.value]} figs={figs} />}</div>
            {t.word && <div className="sv-tile-w">{t.word}</div>}
          </div>
        ))}
      </div>}
      <ul className="sv-lines">
        {v.lines.map((l) => <li key={l.key} className={`t-${l.tone}`}><span className="sv-dot" role="img" aria-label={TONE_HE[l.tone]} /><span><Parts parts={l.parts} figs={figs} />{l.href && <> <Link className="sv-link" to={l.href}>{l.link ?? 'עוד'}</Link></>}</span></li>)}
      </ul>
    </div>
  );
}
