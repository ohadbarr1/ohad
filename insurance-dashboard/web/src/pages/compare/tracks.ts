/* Track compare: the short label and the colour of a column, shared by the shell, the lenses and the sheets (mockup v3 `lab`, `COL`).
   - Label: the company's short name ("מנורה מבטחים" → "מנורה"). Two columns of one company: different categories → "<company> <track>"
     ("מגדל כללי", "מגדל מניות"); the same category → "<company> <what tells the funds apart>" ("הראל גילעד", "הראל מנוף"), from the
     formal name with the company, product and track words removed, else "<company> <fund number>".
   - Colour: by column position, the mockup's order of the site's categorical tokens (--s1, --s2, --s4, --s6, --s7, --s8, --s9, --s11). */
import type { Fund } from '../../lib/useData';

export const SHORT_GRP: Record<string, string> = { 'מנורה מבטחים': 'מנורה', 'אלטשולר שחם': 'אלטשולר' };
export const shortGrp = (grp: string) => SHORT_GRP[grp] ?? grp;

type F = Pick<Fund, 'k' | 'name' | 'grp' | 'prod' | 'track'>;
const STOP = new Set(['-', '–', 'קרן', 'קופת', 'גמל', 'פנסיה', 'מקיפה', 'השתלמות', 'להשקעה', 'מסלול', 'של', 'ביטוח', 'מנהלים', 'פוליסות', 'חיסכון', 'כללי', 'אישית', 'מקפת']);
/** what tells two funds of one company and one category apart: the words of the formal name that are not the company, product or track */
function distinct(f: F): string | null {
  const drop = new Set([...f.grp.split(/\s+/), ...f.prod.split(/\s+/), ...f.track.split(/\s+/)]);
  const w = f.name.replace(/[()"]/g, ' ').split(/\s+/).filter((x) => x && !drop.has(x) && !STOP.has(x) && !/^\d+$/.test(x));
  return w.length ? w.slice(0, 2).join(' ') : null;
}

/** a product in two words or fewer, for a label that needs it ("פנסיה", "פוליסה ישנה") */
export function prodShort(prod: string): string {
  if (/^ביטוחי מנהלים (1990|1992)/.test(prod)) return 'פוליסה ישנה';
  if (/^(פוליסות חיסכון|ביטוחי מנהלים)/.test(prod)) return 'פוליסה';
  if (prod === 'פנסיה מקיפה') return 'פנסיה';
  return prod;
}

/** one short label per column, in column order (missing funds: their key) */
export function trackLabels(funds: (F | null | undefined)[]): string[] {
  const cat = (f: F) => `${f.prod} | ${f.track}`;
  return funds.map((f) => {
    if (!f) return '';
    const g = shortGrp(f.grp), same = funds.filter((x): x is F => !!x && x.grp === f.grp);
    if (same.length < 2) return g;
    if (new Set(same.map(cat)).size > 1 && same.filter((x) => cat(x) === cat(f)).length < 2) {
      // one company, different categories: the track; when two of its tracks share the track's name, the product
      const byTrack = same.filter((x) => x.track === f.track).length > 1;
      return byTrack ? `${g} ${prodShort(f.prod)}${same.filter((x) => prodShort(x.prod) === prodShort(f.prod)).length > 1 ? ` ${f.track}` : ''}` : `${g} ${f.track}`;
    }
    const d = distinct(f), others = same.filter((x) => x !== f && cat(x) === cat(f)).map(distinct);
    const lab = d && !others.includes(d) ? `${g} ${d}` : `${g} ${f.k.replace(/^\D+/, '')}`;
    return lab;
  });
}

/** the column colours, by position (CSS custom properties, so the dark theme follows) */
export const TRACK_VARS = ['--s1', '--s2', '--s4', '--s6', '--s7', '--s8', '--s9', '--s11'];
export const trackColor = (i: number) => `var(${TRACK_VARS[i % TRACK_VARS.length]})`;
/** the same colour resolved to its value (hex) for a chart (canvas cannot read CSS variables) */
export const trackRgb = (i: number): string => {
  const v = TRACK_VARS[i % TRACK_VARS.length];
  return (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(v).trim()) || `var(${v})`;
};
