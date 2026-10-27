import { Link } from 'react-router-dom';
import { GROUP_ID, idCss } from '../lib/identity';
import { useTheme } from '../lib/theme';
import '../styles/lens.css';

/** The managing group of a fund, as a chip in its identity colour: opens the group in the Savings Lens.
 *  `mgr` (the licensed managing company) goes in the tooltip; branch and other funds without a company get the neutral dot. */
export function MgrChip({ grp, mgr, short = false }: { grp: string; mgr?: string; short?: boolean }) {
  const id = GROUP_ID[grp];
  useTheme();  // the dot follows the theme
  return (
    <Link className="mgrchip" to={`/savings?g=${encodeURIComponent(grp)}`} title={mgr ? `${mgr} · ${grp}` : grp} onClick={(e) => e.stopPropagation()}>
      <i style={{ background: id ? idCss(id) : 'var(--neutral)' }} aria-hidden="true" />{short ? grp.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין').replace('קרנות ענפיות ואחרות', 'ענפיות') : grp}
    </Link>
  );
}

/** an identity dot alone, for legends and table rows */
export function IdDot({ grp }: { grp: string }) {
  const id = GROUP_ID[grp];
  useTheme();
  return <i className="iddot" style={{ background: id ? idCss(id) : 'var(--neutral)' }} aria-hidden="true" />;
}
