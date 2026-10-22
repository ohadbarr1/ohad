import { Link, useLocation } from 'react-router-dom';
import { Search } from '../components/Search';

/** A link that leads nowhere says so, and offers the way on, instead of landing silently on the home page. */
export function NotFound() {
  const loc = useLocation();
  return (
    <div className="panel notfound" style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>העמוד לא נמצא</h1>
      <div className="muted">אין עמוד בכתובת <bdi className="num">{loc.pathname}</bdi>. אפשר לחפש חברה, קופה או שורה בדוח:</div>
      <Search big />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="chip" to="/">דף הבית</Link>
        <Link className="chip" to="/companies">חברות</Link>
        <Link className="chip" to="/industry">השוואה ענפית</Link>
        <Link className="chip" to="/funds">קופות</Link>
      </div>
    </div>
  );
}
