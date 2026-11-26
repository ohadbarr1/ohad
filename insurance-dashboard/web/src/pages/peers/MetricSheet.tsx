import { DeeperSheet } from '../../components/DeeperSheet';
import { useAddressWrite } from '../../lib/sheetHost';
import { shOf, type BMetric } from '../../lib/peerBoard';
import '../../styles/peerboard.css';

/* "מדד ▾" (`?sheet=metrics`, spec p6 §3.2 item 4): every board metric of the set, by section (המניה · העסק · חיסכון · ביטוח). One metric
   at a time; the reading (LTM, the quarter, YoY, QoQ, LTM YoY) is picked above the board. A pick closes the sheet, puts the board lens
   up and clears the reading (each metric opens on its own default). The change columns of the tables are this sheet's metrics' YoY. */

type MSec = 'mkt' | 'biz' | 'sav' | 'ins';
const SEC_HE: [MSec, string][] = [['mkt', 'המניה'], ['biz', 'העסק'], ['sav', 'חיסכון'], ['ins', 'ביטוח']];
const secOf = (m: BMetric): MSec => (m.sec === 'ops' ? (m.grp === 'ins' ? 'ins' : 'sav') : m.sec);

export function MetricSheet({ ms, bm, onClose }: { ms: BMetric[]; bm: string; onClose: () => void }) {
  const write = useAddressWrite();
  return (
    <DeeperSheet open onClose={onClose} id="metric-sheet" title="כל המדדים" sub="מדד אחד בכל פעם; הקריאה (LTM, רבעון, YoY, QoQ) נבחרת מעל הלוח">
      {SEC_HE.map(([s, t]) => {
        const xs = ms.filter((m) => secOf(m) === s);
        if (!xs.length) return null;
        return (
          <div key={s} className="p6-ms-sec" data-sec={s}>
            <h3>{t}</h3>
            <div className="p6-optgrid">
              {xs.map((m) => (
                <button key={m.key} type="button" aria-pressed={m.key === bm} data-m={m.key} title={m.l}
                  onClick={() => write({ bm: m.key, rd: null, sheet: null, lens: null })}>{shOf(m)}</button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="p6-sh-note">שינוי של מדד (YoY, QoQ, LTM YoY) נבחר בקריאה שמעל הלוח; עמודות השינוי של הטבלאות נמצאות שם תחת שם המדד.</p>
    </DeeperSheet>
  );
}
