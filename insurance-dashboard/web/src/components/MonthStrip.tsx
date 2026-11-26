import type { CSSProperties } from 'react';
import { HEM, HEMF, heatFill, heatScale, signed } from './MonthGrid';
import '../styles/rollout.css';

/* <MonthStrip>: six months of one track as heat cells (rollout spec §2.3; /my product rows, mockup frame 8). Oldest first in the DOM,
   so in RTL the newest month sits at the end of the line (the left) and is ringed. Each cell: the short month ("אוק׳") and the signed
   figure, two decimals, U+2212 for minus; the heat is MonthGrid's (same scale rule and colours). With `onOpen` every cell is a 44-px
   button that opens that month (the month sheet); without it the strip is a picture with one accessible label. */

export interface StripMonth { p: number; v: number | null }
export interface MonthStripProps {
  months: StripMonth[];         // oldest first, newest last
  scale?: number;               // heat scale; default the strip's own (MonthGrid heatScale)
  onOpen?: (p: number) => void;
  label?: string;               // accessible prefix: the track's name
  id?: string;
}

export function MonthStrip({ months, scale, onOpen, label = '', id }: MonthStripProps) {
  const s = scale ?? heatScale(months.map((m) => m.v));
  const last = months.length - 1;
  const name = (m: StripMonth) => `${label ? `${label}, ` : ''}${HEMF[(m.p % 100) - 1]} ${Math.floor(m.p / 100)}: ${m.v == null ? 'אין נתון' : signed(m.v, 2, true)}`;
  const cells = months.map((m, i) => {
    const h = heatFill(m.v, s);
    const style = { '--k': h.hue ? `var(--heat-${h.hue})` : '0 0 0', '--a': h.alpha } as CSSProperties;
    const inner = <><small>{HEM[(m.p % 100) - 1]}</small><span className="num">{signed(m.v, 2)}</span></>;
    const cls = `ro-sc${i === last ? ' now' : ''}`;
    return onOpen
      ? <button key={m.p} type="button" className={cls} style={style} onClick={() => onOpen(m.p)} aria-label={name(m)}>{inner}</button>
      : <span key={m.p} className={cls} style={style} aria-hidden="true">{inner}</span>;
  });
  return onOpen
    ? <div className="ro-strip" id={id}>{cells}</div>
    : <div className="ro-strip" id={id} role="img" aria-label={months.map(name).join('; ')}>{cells}</div>;
}
