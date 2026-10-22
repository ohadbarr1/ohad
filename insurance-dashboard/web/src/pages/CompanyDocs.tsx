import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { nf, pubLabel } from '../lib/format';
import { useCompanyDocs } from '../lib/useData';
import type { DocEntry } from '../lib/types';
import { DOC_TYPE, useCtx } from './Company';
import { DocSearch } from './DocSearch';
import { Link } from 'react-router-dom';
import { readerHref, ridOf } from '../lib/search';

const COLS: DocEntry['type'][] = ['annual', 'quarterly', 'presentation', 'solvency'];
const REPORT = (p: string): DocEntry['type'] => (p.endsWith('FY') ? 'annual' : 'quarterly');

/** Period × document type. Every cell links to the filed PDF. */
export function CompanyDocs() {
  const { entry } = useCtx();
  const { data, error } = useCompanyDocs(entry.id, entry.docs > 0);
  const [lang, setLang] = useState<'all' | 'he' | 'en'>('all');
  // one row per filed document: the same period, kind, length and language is one filing re-published, and a one-page file is a cover or notice, not a report
  const docs = useMemo(() => {
    const seen = new Set<string>();
    return (data?.docs ?? []).filter((d) => {
      const key = `${d.period}|${d.type}|${d.pages}|${d.en}`;
      if (seen.has(key) || (d.pages != null && d.pages < 3)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);
  const periods = useMemo(() => {
    const by = new Map<string, DocEntry[]>();
    docs.filter((d) => lang === 'all' || (lang === 'en') === d.en).forEach((d) => by.set(d.period, [...(by.get(d.period) ?? []), d]));
    const key = (p: string) => p.slice(0, 4) + (p.endsWith('FY') ? '4' : p.slice(5));
    return [...by.entries()].sort((a, b) => key(b[0]).localeCompare(key(a[0])));
  }, [docs, lang]);
  if (!entry.docs) return <Empty title="אין מסמכים" />;
  if (error) return <ErrorBox what="רשימת המסמכים" error={error} />;
  if (!data) return <Loading what="מסמכים" />;
  const all = docs;
  return (<>
    <DocSearch company={entry.id} />
    <Panel title={<>{nf(all.length, 0)} מסמכים · <span className="num">{nf(all.reduce((s, d) => s + (d.pages ?? 0), 0), 0)}</span> עמודים</>}
      aside={<><span>מקור: MAYA</span><Seg label="שפה" value={lang} onChange={setLang} options={[['all', 'הכול'], ['he', 'עברית'], ['en', 'English']]} /></>}>
      <div className="scroll" style={{ maxHeight: 720 }}><table className="docs">
        <thead><tr><th>תקופה</th><th>דוח כספי</th><th>מצגת</th><th>כושר פירעון</th><th>פורסם</th></tr></thead>
        <tbody>{periods.map(([p, ds]) => {
          // a filed PDF opens in the reader (its text, what was extracted from each page, and a link to the original)
          const cell = (types: DocEntry['type'][]) => ds.filter((d) => types.includes(d.type)).map((d) => {
            const rid = ridOf(d.url) ?? d.id;
            return <Link key={d.url} to={readerHref(rid)} title={d.title} className="doc">{d.en ? 'EN' : DOC_TYPE[d.type]}<span className="num">{d.pages ?? ''}</span></Link>;
          });
          const first = ds.filter((d) => d.type === REPORT(p)).map((d) => d.date).sort()[0] ?? ds.map((d) => d.date).sort()[0];
          return <tr key={p}><td><span className="num">{p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`}</span></td><td>{cell(['annual', 'quarterly'])}</td><td>{cell(['presentation'])}</td><td>{cell(['solvency'])}</td><td><span className="num">{pubLabel(first)}</span></td></tr>;
        })}</tbody>
      </table></div>
      <div className="src">המספר בכל תא: עמודים ב-PDF; לחיצה פותחת את המסמך בקורא. {COLS.length} סוגי מסמך, מסווגים לפי כותרת הדיווח. ללא כפילויות וללא מסמכים של עמוד אחד.</div>
    </Panel>
  </>);
}
