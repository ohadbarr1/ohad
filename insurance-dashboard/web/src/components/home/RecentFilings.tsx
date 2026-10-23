import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { pubLabel } from '../../lib/format';
import { useLoad, useRegistry } from '../../lib/useData';
import type { DocEntry } from '../../lib/types';
import '../../styles/home-feed.css';

export type Filing = DocEntry & { company: string };
export const FILING_TYPE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };
export const filingPeriod = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
export const useFilings = () => useLoad<{ docs: Filing[] }>('filings_latest.json');

/** Filings as a feed: company, document, pages, publication date on one line. The home shows only the ones new since the last visit;
 *  the full list belongs to the calendar (`RecentFilingsPanel`). */
export function FilingsFeed({ docs, name, fresh }: { docs: Filing[]; name: (id: string) => string; fresh?: (f: Filing) => boolean }) {
  return (
    <ul className="feed">{docs.map((f) => {
      const t = FILING_TYPE[f.type] ?? f.type;
      return (
        <li key={f.id}>
          <Link className="co" to={`/company/${f.company}`}>{name(f.company)}</Link>
          {fresh?.(f) && <span className="chip loaded">חדש</span>}
          <a className="fdoc" href={f.url} target="_blank" rel="noreferrer">{t} <span className="num">{filingPeriod(f.period)}</span></a>
          {f.pages != null && <Sourced className="num muted pg" src={() => ({ k: 'report', title: `מספר עמודים · ${t}`, value: String(f.pages), unit: 'עמודים', url: f.url, pg: null, doc: t, period: filingPeriod(f.period) })}>{`${f.pages} עמ׳`}</Sourced>}
          <span className="num muted dt">{pubLabel(f.date)}</span>
        </li>
      );
    })}</ul>
  );
}

/** The latest Hebrew filings of every covered company (MAYA), for the calendar page. */
export function RecentFilingsPanel({ limit = 20 }: { limit?: number }) {
  const { data } = useFilings();
  const reg = useRegistry();
  const docs = (data?.docs ?? []).filter((x) => !x.en).slice(0, limit);
  if (!docs.length) return null;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  return (
    <section className="panel filings" id="recent">
      <div className="hd"><h2>פורסמו לאחרונה</h2><div className="aside"><span>MAYA</span></div></div>
      <FilingsFeed docs={docs} name={name} />
    </section>
  );
}
