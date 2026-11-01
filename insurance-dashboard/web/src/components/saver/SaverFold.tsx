import { useId, useState, type ReactNode } from 'react';
import { useDoor } from '../../lib/door';

/** The fund card's advanced sections (KPI strip, Sharpe, by year, rank and risk over time, crises, monthly heatmap, exposures, flows and
 *  their CSV/PPTX exports) behind one "פרטים מקצועיים" bar when the reader came through the saver door. Agent and Pro: unchanged.
 *  Closed, the sections are not mounted at all (their charts would measure a hidden box), so the saver's page is also lighter. */
export function SaverFold({ children }: { children: ReactNode }) {
  const [door] = useDoor();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (door !== 'saver') return <>{children}</>;
  return (
    <>
      <button type="button" className="sv-fold" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="sv-fold-t">פרטים מקצועיים</span>
        <span className="sv-fold-s">תשואות לפי תקופה, שארפ, משברים, תשואות חודשיות, חשיפות, תזרים וייצוא</span>
        <span className="sv-fold-i" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {/* display: contents, so the sections stay items of the page column, with its spacing */}
      <div id={id} hidden={!open} className="sv-fold-body">{open && children}</div>
    </>
  );
}
