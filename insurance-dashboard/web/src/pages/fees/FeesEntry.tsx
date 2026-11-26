import { Link } from 'react-router-dom';
import { ProdIcon } from '../../components/compare/PickerSheet';
import { TILES } from '../../lib/pickTiles';
import { FEES_ENTRY_ADD, FEES_ENTRY_LINE, FEES_ENTRY_NOTE, FEES_TITLE } from '../../lib/pageWords';
import '../../components/compare/picker.css';

/* The fees tool's entry (rollout spec §7.2 "never opens on a track the reader did not pick", mockup v4 `pageFees` first branch; T-F1):
   a saver (or a visitor with no door) with no saved product and no product in the address sees one screen: "על איזה חיסכון?", the six
   product tiles (#fee-pick, the picker's isometric icons) and "יש לי מסלול מסוים: להוסיף אותו ל״המוצרים שלי״". No fund is named here.
   One tap on a tile opens the board of that product's general track, with the type picker beside it. */

export function FeesEntry({ onPick }: { onPick: (prod: string) => void }) {
  return (
    <div className="fb-entry">
      <div className="fb-hero">
        <h1>{FEES_TITLE}</h1>
        <p>{FEES_ENTRY_LINE}</p>
      </div>
      <div className="pk-prods" id="fee-pick">
        {TILES.map((t) => (
          <button key={t.id} type="button" className="pk-prod" data-tile={t.id} onClick={() => onPick(t.prods[0])}>
            <ProdIcon art={t.art} /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <Link className="ro-rowlink fb-calc" to="/my" id="fee-add">
        <span className="fb-ic plus" aria-hidden="true">＋</span><span className="fb-calct">{FEES_ENTRY_ADD}</span><span aria-hidden="true">›</span>
      </Link>
      <p className="ro-stamp">{FEES_ENTRY_NOTE}</p>
    </div>
  );
}
