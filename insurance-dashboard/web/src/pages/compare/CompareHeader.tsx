import { forwardRef } from 'react';
import { TrackBar, type TrackBarItem } from '../../components/TrackBar';
import type { Door } from '../../lib/door';
import type { View } from './contract';
import './shell.css';

/* Track compare, the head of the page (spec v3 §4.0b rows 1 and 5, §10A.2 C1/D1):
   - an eyebrow: the pink icon tile and the category as a one-line title ("פנסיה מקיפה · כללי"); no header share button (C10: sharing is
     at the page's end);
   - the track chips (<TrackBar>): a tap opens the track sheet; "＋ מסלול" opens the picker, absent at the door's cap;
   - the view strip: one sticky, opaque strip, at most five tabs, never scrolls: "6 חודשים | 12 חודשים | שנים | לאורך זמן" for every door,
     and a fifth tab by door: none (saver), "להחלטה" (agent), "מקצועי" (Pro: opens "להחלטה", with the switch "להחלטה | סיכון" in the lens). */

const Bars = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V12M10 20V5M15 20v-9M20 20v-6" /></svg>;

export function CompareHeader({ title, items, onOpen, onAdd }: { title: string; items: TrackBarItem[]; onOpen: (k: string) => void; onAdd?: () => void }) {
  return (
    <>
      <div className="cmp-eyebrow">
        <span className="cmp-tile"><Bars /></span>
        <h1 id="cmp-title">{title}</h1>
      </div>
      <TrackBar items={items} onOpen={onOpen} onAdd={onAdd} />
    </>
  );
}

/** the strip's tabs for a door: the four shared views, then the door's fifth (D1) */
export function viewTabs(door: Door): [string, string][] {
  const base: [string, string][] = [['m6', '6 חודשים'], ['m12', '12 חודשים'], ['y', 'שנים'], ['long', 'לאורך זמן']];
  return door === 'agent' ? [...base, ['dec', 'להחלטה']] : door === 'pro' ? [...base, ['dec', 'מקצועי']] : base;
}
/** the tab that is lit for a view ("מקצועי" stays lit in both Pro lenses) */
export const tabOf = (v: View): string => (v === 'risk' ? 'dec' : v);

export const ViewStrip = forwardRef<HTMLDivElement, { door: Door; view: View; onChange: (v: View) => void }>(function ViewStrip({ door, view, onChange }, ref) {
  const tabs = viewTabs(door), on = tabOf(view);
  return (
    <div className="cmp-stick" ref={ref}>
      <div className="cmp-views" id="views" role="tablist" aria-label="תצוגה">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={k === on} className={k === on ? 'on' : undefined} onClick={() => onChange(k as View)}>{l}</button>
        ))}
      </div>
    </div>
  );
});
