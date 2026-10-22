import { Chart } from '../../components/Chart';
import { Panel } from '../../components/ui';
import { foxOption } from '../../lib/foxchart';
import { cssColor } from '../../lib/theme';

/** The risk modules of the Solvency II standard formula as the Israeli economic-solvency reports print them, in the order of the report. */
export const SCR_MODULES = [
  ['market', 'סיכון שוק'], ['counterparty', 'סיכון צד נגדי'], ['life', 'חיתום ביטוח חיים'], ['health', 'חיתום ביטוח בריאות'], ['nonlife', 'חיתום ביטוח כללי'],
  ['diversification', 'השפעת פיזור'], ['intangible', 'נכסים בלתי מוחשיים'], ['operational', 'סיכון תפעולי'], ['lac', 'התאמה לספיגת הפסדים (מס ותחייבויות)'],
] as const;
export type ScrModule = (typeof SCR_MODULES)[number][0];
/** One insurer at one solvency date, each module with its page; filled by the solvency-report extraction. */
export interface ScrRow { c: string; d: string; scr: number; mods: Partial<Record<ScrModule, { v: number; pg: number | null; u: string | null }>> }

/** SCR by risk module per insurer. The modules are read from the economic-solvency reports, not from the financial statements;
    until that extraction runs there is nothing to show, and the panel says so in one line. */
export function ScrComposition({ ids, name, rows = [] }: { ids: string[]; name: (id: string) => string; rows?: ScrRow[] }) {
  const latest = ids.map((id) => rows.filter((r) => r.c === id).sort((a, b) => b.d.localeCompare(a.d))[0]).filter((r): r is ScrRow => !!r);
  return (
    <Panel title="הרכב SCR לפי מודול סיכון" aside={latest.length ? <span>% מסך ה-SCR לפני פיזור</span> : undefined}>
      {latest.length === 0 ? <div className="src">ממתין לחילוץ דוחות כושר פירעון</div> : (
        <Chart label="הרכב SCR לפי מודול סיכון" height={Math.max(220, latest.length * 34 + 70)} deps={[latest.length]} build={() => foxOption({
          x: latest.map((r) => name(r.c)), unit: '%', legend: true, labels: false, full: true,
          series: SCR_MODULES.filter(([k]) => k !== 'diversification' && k !== 'lac').map(([k, l], i) => ({ name: l, kind: 'bar' as const, stack: true, color: cssColor(`--s${i + 1}`), dec: 0,
            data: latest.map((r) => { const gross = SCR_MODULES.reduce((t, [m]) => t + (m === 'diversification' || m === 'lac' ? 0 : r.mods[m]?.v ?? 0), 0), v = r.mods[k]?.v; return v == null || !gross ? null : +((v / gross) * 100).toFixed(1); }) })),
        })} />
      )}
    </Panel>
  );
}
