import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { nf } from '../lib/format';
import { useCompanyDocs } from '../lib/useData';
import type { DocEntry } from '../lib/types';
import { DOC_TYPE, useCtx } from './Company';
import { DocSearch } from './DocSearch';
import { useIfrsData } from '../lib/useData';

const COLS: DocEntry['type'][] = ['annual', 'quarterly', 'presentation', 'solvency'];
const REPORT = (p: string): DocEntry['type'] => (p.endsWith('FY') ? 'annual' : 'quarterly');

/** Period × document type. Every cell links to the filed PDF. */
export function CompanyDocs() {
  const { entry } = useCtx();
  const { data, error } = useCompanyDocs(entry.id, entry.docs > 0);
  const ifrs = useIfrsData().data;
  const [lang, setLang] = useState<'all' | 'he' | 'en'>('all');
  const periods = useMemo(() => {
    const by = new Map<string, DocEntry[]>();
    (data?.docs ?? []).filter((d) => lang === 'all' || (lang === 'en') === d.en).forEach((d) => by.set(d.period, [...(by.get(d.period) ?? []), d]));
    const key = (p: string) => p.slice(0, 4) + (p.endsWith('FY') ? '4' : p.slice(5));
    return [...by.entries()].sort((a, b) => key(b[0]).localeCompare(key(a[0])));
  }, [data, lang]);
  if (!entry.docs) return <Empty title="אין מסמכים" />;
  if (error) return <ErrorBox what="רשימת המסמכים" error={error} />;
  if (!data) return <Loading what="מסמכים" />;
  const all = data.docs;
  return (<>
    {ifrs?.files.some((f) => f.company === entry.id) && <DocSearch company={entry.id} />}
    <Panel title={<>{nf(all.length, 0)} מסמכים · <span className="num">{nf(all.reduce((s, d) => s + (d.pages ?? 0), 0), 0)}</span> עמודים</>}
      aside={<><span>מקור: MAYA</span><Seg label="שפה" value={lang} onChange={setLang} options={[['all', 'הכול'], ['he', 'עברית'], ['en', 'English']]} /></>}>
      <div className="scroll" style={{ maxHeight: 720 }}><table className="docs">
        <thead><tr><th>תקופה</th><th>דוח כספי</th><th>מצגת</th><th>כושר פירעון</th><th>פורסם</th></tr></thead>
        <tbody>{periods.map(([p, ds]) => {
          const cell = (types: DocEntry['type'][]) => ds.filter((d) => types.includes(d.type)).map((d) => (
            <a key={d.url} href={d.url} target="_blank" rel="noreferrer" title={d.title} className="doc">{d.en ? 'EN' : DOC_TYPE[d.type]}<span className="num">{d.pages ?? ''}</span></a>
          ));
          const first = ds.filter((d) => d.type === REPORT(p)).map((d) => d.date).sort()[0] ?? ds.map((d) => d.date).sort()[0];
          return <tr key={p}><td><span className="num">{p.endsWith('FY') ? `FY ${p.slice(0, 4)}` : `${p.slice(4)} ${p.slice(0, 4)}`}</span></td><td>{cell(['annual', 'quarterly'])}</td><td>{cell(['presentation'])}</td><td>{cell(['solvency'])}</td><td><span className="num">{first}</span></td></tr>;
        })}</tbody>
      </table></div>
      <div className="src">המספר בכל תא: עמודים ב-PDF. {COLS.length} סוגי מסמך, מסווגים לפי כותרת הדיווח.</div>
    </Panel>
  </>);
}
