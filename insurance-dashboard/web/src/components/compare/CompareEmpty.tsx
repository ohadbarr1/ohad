import { useMemo } from 'react';
import type { CmpCtx } from '../../pages/compare/contract';
import { useMine } from '../../lib/mine';
import { compareKeys } from '../../lib/saverCompare';
import { TRAY_MAX, useTray } from '../../lib/funds';
import { TILES, capOf, house, prodShort, tileOf, trackLabels } from '../../lib/pickTiles';
import type { VFund } from '../../lib/verdict';
import { ProdIcon, SEARCH_PH, SearchSvg, openPicker, useFundRows, useRecents } from './PickerSheet';
import './picker.css';

/* <CompareEmpty> (C6, spec §4.1, mockup v3 frame 1): the compare page with no tracks yet. "איזה מסלול יש לך?"; one search field that
   opens the picker with the keyboard up; "המסלול שלי": one card per saved track (lib/mine), "השוואה ›" = that track against the two
   largest of its category (lib/saverCompare, O3), one tap to the answer; "או לפי סוג החיסכון": the six product tiles, each opening the
   picker at step 2; "השוואות אחרונות": the last three sets of this browser (cmp:recent). Nothing here invents data: the cards show
   names only, the comparison itself is the page. */

export function CompareEmpty(ctx: CmpCtx) {
  const { door, setKeys } = ctx;
  const funds = useFundRows();
  const by = useMemo(() => new Map((funds ?? []).map((f) => [f.k, f])), [funds]);
  const [mine] = useMine();
  const [recents, remember] = useRecents();
  const tray = useTray();
  const cap = capOf(door, TRAY_MAX);
  const open = (ks: string[]) => { const v = ks.slice(0, cap); if (!v.length) return; remember(v); tray.set(v); setKeys(v); };

  // one card per saved track (the same track saved twice once), known to funds.json
  const mineF = funds ? [...new Set(mine.map((m) => m.k))].map((k) => by.get(k)).filter((f): f is NonNullable<typeof f> => !!f && !f.closed) : [];
  const recentsOk = funds ? recents.map((ks) => ks.filter((k) => by.has(k))).filter((ks) => ks.length >= 2) : [];

  return (
    <div className="cmp-empty" id="cmp-empty">
      <div className="pk-hero">
        <h1>איזה מסלול יש לך?</h1>
        <p>נראה כמה הוא הרוויח, חודש אחרי חודש, מול מסלולים דומים.</p>
      </div>
      <button type="button" className="pk-search" id="open-search" onClick={() => openPicker(ctx, { focus: true })} aria-haspopup="dialog">
        <SearchSvg /><span>{SEARCH_PH}</span>
      </button>

      {mineF.length ? (
        <>
          <div className="pk-h" id="cmp-mine"><span>המסלול שלי</span></div>
          <div className="pk-sugg">
            {mineF.map((f) => (
              <button key={f.k} type="button" className="pk-sg" onClick={() => open(compareKeys([{ k: f.k }], funds as unknown as VFund[], cap))}>
                <span className="ic"><ProdIcon art={(tileOf(f.prod) ?? TILES[0]).art} size={38} /></span>
                <span><b>{house(f.grp)} · {prodShort(f.prod)} {f.track}</b><small>מול שני הגדולים מאותו סוג</small></span>
                <span className="go">השוואה ›</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="pk-h"><span>או לפי סוג החיסכון</span></div>
      <div className="pk-prods" id="cmp-prods">
        {TILES.map((t) => (
          <button key={t.id} type="button" className="pk-prod" onClick={() => openPicker(ctx, { tile: t.id })} aria-haspopup="dialog">
            <ProdIcon art={t.art} /><span>{t.label}</span>
          </button>
        ))}
      </div>

      {recentsOk.length ? (
        <>
          <div className="pk-h" id="cmp-recent"><span>השוואות אחרונות</span></div>
          <div className="pk-sugg">
            {recentsOk.map((ks) => {
              const fs = ks.map((k) => by.get(k)!);
              const cats = new Set(fs.map((f) => `${f.prod} | ${f.track}`)), prods = new Set(fs.map((f) => f.prod));
              return (
                <button key={ks.join()} type="button" className="pk-sg" onClick={() => open(ks)}>
                  <span><b>{trackLabels(fs).join(' · ')}</b><small>{prods.size > 1 ? 'מוצרים שונים' : cats.size > 1 ? `${prodShort(fs[0].prod)} · רמות סיכון שונות` : `${prodShort(fs[0].prod)} · ${fs[0].track}`}</small></span>
                  <span className="go">פתיחה ›</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
