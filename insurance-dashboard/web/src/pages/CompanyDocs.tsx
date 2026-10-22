import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { nf, pubLabel } from '../lib/format';
import { useCompanyDocs } from '../lib/useData';
import type { DocEntry } from '../lib/types';
import { DOC_TYPE, useCtx } from './Company';
import { DocSearch } from './DocSearch';
import { Link } from 'react-router-dom';
import { readerHref, ridOf } from '../lib/search';
import { DataTable } from '../components/DataTable';

const COLS: DocEntry['type'][] = ['annual', 'quarterly', 'presentation', 'solvency'];
const REPORT = (p: string): DocEntry['type'] => (p.endsWith('FY') ? 'annual' : 'quarterly');

const plab = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const pkey = (p: string) => p.slice(0, 4) + (p.endsWith('FY') ? '4' : p.slice(5));
// a filed PDF opens in the reader (its text, what was extracted from each page, and a link to the original)
const cell = (ds: DocEntry[], types: DocEntry['type'][]) => ds.filter((d) => types.includes(d.type)).map((d) => {
  const rid = ridOf(d.url) ?? d.id;
  return <Link key={d.url} to={readerHref(rid)} title={d.title} className="doc">{d.en ? 'EN' : DOC_TYPE[d.type]}<span className="num">{d.pages ?? ''}</span></Link>;
});
const pagesOf = (ds: DocEntry[], types: DocEntry['type'][]) => ds.filter((d) => types.includes(d.type)).map((d) => `${d.en ? 'EN' : DOC_TYPE[d.type]} ${d.pages ?? ''}`.trim()).join(' · ');
const firstDate = (p: string, ds: DocEntry[]) => ds.filter((d) => d.type === REPORT(p)).map((d) => d.date).sort()[0] ?? ds.map((d) => d.date).sort()[0];

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
    return [...by.entries()].sort((a, b) => pkey(b[0]).localeCompare(pkey(a[0])));
  }, [docs, lang]);
  if (!entry.docs) return <Empty title="אין מסמכים" />;
  if (error) return <ErrorBox what="רשימת המסמכים" error={error} />;
  if (!data) return <Loading what="מסמכים" />;
  const all = docs;
  return (<>
    <DocSearch company={entry.id} />
    <Panel title={<>{nf(all.length, 0)} מסמכים · <span className="num">{nf(all.reduce((s, d) => s + (d.pages ?? 0), 0), 0)}</span> עמודים</>}
      aside={<><span>מקור: MAYA</span><Seg label="שפה" value={lang} onChange={setLang} options={[['all', 'הכול'], ['he', 'עברית'], ['en', 'English']]} /></>}>
      <DataTable className="docs" caption="מסמכים לפי תקופה" maxHeight={720} rows={periods} rowKey={([p]) => p} export={{ name: `fox-${entry.id}-docs`, title: `מסמכים · ${entry.name_he}`, note: 'מקור: MAYA · מספר עמודים בכל מסמך' }} columns={[
        { key: 'p', head: 'תקופה', value: ([p]) => pkey(p), text: ([p]) => plab(p), cell: ([p]) => <span className="num">{plab(p)}</span> },
        { key: 'fs', head: 'דוח כספי', cell: ([, ds]) => cell(ds, ['annual', 'quarterly']), text: ([, ds]) => pagesOf(ds, ['annual', 'quarterly']) },
        { key: 'pres', head: 'מצגת', cell: ([, ds]) => cell(ds, ['presentation']), text: ([, ds]) => pagesOf(ds, ['presentation']) },
        { key: 'sol', head: 'כושר פירעון', cell: ([, ds]) => cell(ds, ['solvency']), text: ([, ds]) => pagesOf(ds, ['solvency']) },
        { key: 'pub', head: 'פורסם', value: ([p, ds]) => firstDate(p, ds), text: ([p, ds]) => pubLabel(firstDate(p, ds)), cell: ([p, ds]) => <span className="num">{pubLabel(firstDate(p, ds))}</span> },
      ]} />
      <div className="src">המספר בכל תא: עמודים ב-PDF; לחיצה פותחת את המסמך בקורא. {COLS.length} סוגי מסמך, מסווגים לפי כותרת הדיווח. ללא כפילויות וללא מסמכים של עמוד אחד.</div>
    </Panel>
  </>);
}
