import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Panel } from '../components/ui';
import { TextResults } from './SearchPage';

/** Full-text search in one company's filings (reports, presentations, solvency reports). A hit opens the in-app reader on its page. */
export function DocSearch({ company }: { company?: string }) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  if (!company) return <DocSearchRedirect />;
  return (
    <Panel title="חיפוש במסמכי החברה" aside={q ? <Link to={`/search?q=${encodeURIComponent(q)}&co=${company}`}>בחיפוש המלא</Link> : undefined}>
      <form className="controls" role="search" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); }}>
        <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="רכיב הפסד, 17,717, דיבידנד" aria-label="חיפוש במסמכי החברה" autoComplete="off" enterKeyHint="search" style={{ flex: '1 1 260px' }} />
        <button type="submit" className="btn" disabled={draft.trim().length < 2}>חיפוש</button>
      </form>
      {q.length >= 2 && <TextResults q={q} company={company} compact />}
    </Panel>
  );
}

/** the old address of the search (/industry/search?q=…) */
export function DocSearchRedirect() {
  const loc = useLocation();
  return <Navigate to={`/search${loc.search}`} replace />;
}
