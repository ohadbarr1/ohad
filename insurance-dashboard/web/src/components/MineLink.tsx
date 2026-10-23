import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import '../styles/mine.css';

/** The header's way to "שלי" on a phone (the desktop rail has its own item). */
export function MineLink() {
  return (
    <NavLink to="/mine" className="iconbtn minelink" aria-label="שלי" title="שלי: מעקב, תצוגות, הערות">
      <Icon name="mine" />
    </NavLink>
  );
}
