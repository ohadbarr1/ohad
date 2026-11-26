import { Est } from '../saver/figs';
import { useOptional } from '../../lib/fundsLoad';
import { fundP, monthsBack, type TrackRef } from '../../lib/market';
import { nf } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import type { FundX } from '../../lib/funds';
import { SIG_PATH, saverAlert, signalOf, ym, type SigFile } from '../../lib/flows';
import { migProv } from '../../lib/flags';

/* Wave 3 · the saver's one line on a folded product card (/my): only when the track lost money on net over 3 months while most of
   its category gained, or when the build flagged money moving between the group's own tracks. Otherwise nothing (the /my word cap). */
export function FlowLine({ f, R }: { f: FundX; R: TrackRef }) {
  const sig = useOptional<SigFile>(SIG_PATH);
  const s = signalOf(sig, f.k, `${f.prod} | ${f.track}`);
  const why = saverAlert(s, !!f.mig);
  if (!why) return null;
  if (why === 'mig') {
    // build review B1 (novice #3): the saver's words, not the methodology's label (MIG_HE stays the label of the source sheet)
    return <p className="sv-flow" data-testid="flow-line"><Est src={() => migProv(f as FundX & { mig: { grp: number; n: number } })}>כסף עבר מהמסלול הזה</Est> למסלולים אחרים של אותה חברה; מהחברה עצמה הוא לא יצא.</p>;
  }
  const asof = sig!.asof;
  const p3: Prov = { k: 'calc', title: `צבירה נטו, 3 חודשים · ${f.name}`, value: nf(s!.nd3!, 1), unit: 'מיליוני ש"ח', formula: `סכום NET_MONTHLY_DEPOSITS של 3 החודשים עד ${ym(asof)}`,
    note: `${s!.up3} מתוך ${s!.n3} המסלולים בקטגוריה בצבירה נטו חיובית באותם חודשים`,
    inputs: monthsBack(asof, 3).map((p) => ({ label: ym(p), v: 'ברשומה', src: () => fundP(R, p, 'NET_MONTHLY_DEPOSITS', 'צבירה נטו', 'ברשומה', 'מיליוני ש"ח') })) };
  return <p className="sv-flow" data-testid="flow-line">ב-3 חודשים יצאו מהמסלול נטו <Est src={() => p3}>{`₪${nf(Math.abs(s!.nd3!), 0)} מיליון`}</Est>; רוב המסלולים הדומים גדלו.</p>;
}
