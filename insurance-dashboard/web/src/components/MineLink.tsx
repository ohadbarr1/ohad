import { NavLink } from 'react-router-dom';
import '../styles/mine.css';

/** The header's way to "שלי" on a phone (the desktop rail has its own item). */
export function MineLink() {
  return (
    <NavLink to="/mine" className="iconbtn minelink" aria-label="שלי" title="שלי: מעקב, תצוגות, הערות">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20.5c.8-3.6 3.9-5.8 7.5-5.8s6.7 2.2 7.5 5.8" /></svg>
    </NavLink>
  );
}
