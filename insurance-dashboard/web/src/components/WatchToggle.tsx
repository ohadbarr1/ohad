import { useSubs } from '../lib/watchLoad';
import type { SubKind } from '../lib/watch';
import '../styles/watch.css';

/** S10 · "עקוב": follow a question, a finding, a topic or a company. Kept in this browser only; /watch shows what changed since the last look */
export function WatchToggle({ k, id, what, compact }: { k: SubKind; id: string; what: string; compact?: boolean }) {
  const [subs, toggle] = useSubs();
  const on = subs[k].includes(id);
  return (
    <button type="button" className={`wt-btn${on ? ' on' : ''}${compact ? ' compact' : ''}`} aria-pressed={on} onClick={() => toggle(k, id)}
      title={on ? `במעקב: ${what}. לחיצה: הפסקת המעקב` : `מעקב אחרי ${what}: כשהתשובה משתנה, זה מופיע ב"מה השתנה" (נשמר בדפדפן הזה בלבד)`}>
      <span aria-hidden="true">{on ? '✓' : '+'}</span>{on ? 'במעקב' : 'עקוב'}<span className="sr-only">: {what}</span>
    </button>
  );
}
