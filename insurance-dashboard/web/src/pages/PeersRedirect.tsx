import { Navigate, useLocation } from 'react-router-dom';
import { formulaTok } from '../lib/seriesCols';

/** Old comparison pages open the peer table on the matching view: the old address's choices carried into the new one. */
type Old = 'matrix' | 'lines' | 'headline' | 'sectors';
const KPI: Record<string, string> = { profit: 'xbrl:profit', oci: 'xbrl:oci', pretax: 'xbrl:pretax', equity: 'xbrl:equity', assets: 'xbrl:assets', eps: 'xbrl:eps', revenue: 'xbrl:revenue', cfo: 'xbrl:cfo',
  roe: formulaTok('ROE', 'pct', 'xnp / avg(xeq, lag(xeq, 4)) * 100'), leverage: formulaTok('נכסים להון', 'x', 'xta / xeq') };
const FREQ: Record<string, string> = { q: 'Q', ltm: 'LTM', fy: 'FY', Q: 'Q', H: 'H', FY: 'FY', LTM: 'LTM' };
const SET: Record<string, string> = { ins: 'ins', fund: 'fund', all: 'all' };

export function peersTarget(old: Old, search: string): string {
  const o = new URLSearchParams(search), n = new URLSearchParams();
  const yr = Number(o.get('y')), per = (f: string) => (f === 'FY' ? 1 : f === 'H' ? 2 : 4);
  if (old === 'matrix') n.set('t', 'prof');
  if (old === 'lines') {
    const f = FREQ[o.get('t') ?? 'Q'] ?? 'Q';
    n.set('v', 'series'); n.append('c', `${o.get('v') === 'y' ? 'y!' : ''}fs:${o.get('l') ?? 'ins_res'}`); n.set('s', SET[o.get('g') ?? 'ins'] ?? 'ins');
    if (f !== 'LTM') n.set('f', f); else n.set('f', 'LTM');
    if (o.get('c')) n.set('hl', o.get('c')!);
    n.set('w', String(Math.min(40, Math.max(8, ((new Date().getFullYear()) - (yr || 2020) + 1) * per(f)))));
  }
  if (old === 'headline') {
    const f = FREQ[o.get('b') ?? 'ltm'] ?? 'LTM';
    n.set('v', 'series'); n.append('c', KPI[o.get('k') ?? 'profit'] ?? KPI.profit); n.set('s', 'all'); n.set('f', f);
    if (o.get('c')) n.set('hl', o.get('c')!);
    n.set('w', String(Math.min(40, Math.max(8, ((new Date().getFullYear()) - (yr || 2022) + 1) * per(f)))));
  }
  if (old === 'sectors') {
    n.set('t', 'lts'); n.set('v', 'deck');
    if (o.get('c')) n.set('dc', o.get('c')!);
    if (o.get('p')) n.set('dp', o.get('p')!);
    if (o.get('v')) n.set('dv', o.get('v')!);
  }
  if (o.get('src')) n.set('src', o.get('src')!);
  const q = n.toString();
  return `/industry/peers${q ? `?${q}` : ''}`;
}

export function PeersRedirect({ from }: { from: Old }) {
  const loc = useLocation();
  return <Navigate to={peersTarget(from, loc.search)} replace />;
}
export const FromMatrix = () => <PeersRedirect from="matrix" />;
export const FromLines = () => <PeersRedirect from="lines" />;
export const FromHeadline = () => <PeersRedirect from="headline" />;
export const FromSectors = () => <PeersRedirect from="sectors" />;
