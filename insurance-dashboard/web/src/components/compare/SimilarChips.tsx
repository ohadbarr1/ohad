import { useMemo } from 'react';
import type { CmpCtx } from '../../pages/compare/contract';
import { TRAY_MAX } from '../../lib/funds';
import { capOf, similarOf, trackLabels } from '../../lib/pickTiles';
import { useFundRows } from './PickerSheet';
import './picker.css';

/* <SimilarChips> (C7, spec §4.3 item 9, §5.3, §6.4, mockup v3 frame 3): "אותו מסלול בחברה אחרת: ＋ כלל ＋ הראל מנוף". One tap adds a
   column. The open tracks of the first track's category that are not on screen, largest first, as many as the door's cap leaves room
   for (at most four). Nothing when the tracks on screen are of different categories (risk levels or products) or at the cap.
   A chip's name is the name its column will carry (the page's own label rules, with the new track beside the ones on screen). */

export function SimilarChips({ keys, door, setKeys }: CmpCtx & { max?: number }) {
  const funds = useFundRows();
  const cap = capOf(door, TRAY_MAX);
  const more = useMemo(() => (funds ? similarOf(funds, keys, cap) : []), [funds, keys, cap]);
  if (!funds || !more.length) return null;
  const by = new Map(funds.map((f) => [f.k, f]));
  const on = keys.map((k) => by.get(k));
  return (
    <div className="similar" id="similar">
      <span>אותו מסלול בחברה אחרת:</span>
      {more.map((f) => {
        const lab = trackLabels([...on, f]).at(-1);
        return <button key={f.k} type="button" className="pk-chip" onClick={() => setKeys([...keys, f.k])}>＋ {lab}</button>;
      })}
    </div>
  );
}
