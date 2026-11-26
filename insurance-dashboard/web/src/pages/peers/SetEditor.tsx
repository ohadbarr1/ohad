import { useState } from 'react';
import { idCss } from '../../lib/identity';
import type { PeerSet, Registry } from '../../lib/registry';

/* ---------- peer sets ---------- */
export function SetEditor({ reg, ents, onChange, onSave, own, onDelete }: { reg: Registry; ents: string[]; onChange: (ids: string[]) => void; onSave: (name: string) => void; own: PeerSet | null; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  const groups: [string, string][] = [['ins', 'מבטחות'], ['fund', 'בתי השקעות']];
  return (
    <section className="panel pr-seted" aria-label="עריכת קבוצת עמיתים">
      {groups.map(([k, n]) => (
        <div key={k} className="pr-row"><span className="muted pr-gl">{n}</span>{reg.entities.filter((e) => e.k === k).map((e) => (
          <button key={e.id} type="button" className="chip" aria-pressed={ents.includes(e.id)} onClick={() => onChange(ents.includes(e.id) ? ents.filter((x) => x !== e.id) : reg.entities.map((x) => x.id).filter((x) => x === e.id || ents.includes(x)))}><i className="sw" style={{ background: idCss(e.id) }} />{e.sh ?? e.n}</button>
        ))}</div>
      ))}
      <div className="pr-row">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הקבוצה" aria-label="שם הקבוצה" />
        <button type="button" className="btn" disabled={!name.trim() || !ents.length} onClick={() => { onSave(name.trim()); setName(''); }}>שמירה כקבוצה</button>
        {own && <button type="button" className="btn" onClick={() => onDelete(own.id)}>מחיקת “{own.n}”</button>}
        <span className="src">נשמר בדפדפן זה</span>
      </div>
    </section>
  );
}

