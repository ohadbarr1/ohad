import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { CHECK_HE, CHECK_WHY, EXP_LABEL, MIG_HE, migProv } from '../lib/flags';
import type { FundX } from '../lib/funds';
import type { Prov } from '../lib/prov';

/* W6 trust: the flow measures named exactly where they are shown, and the two data flags as chips. Every table that shows a flow carries
   a FlowDef under its header, linking to the definitions at /methodology#flows. */

export type FlowKind = 'netflow' | 'organic' | 'transfers' | 'nd';
export const FLOW_DEF: Record<FlowKind, string> = {
  netflow: 'צבירה נטו: הפקדות פחות משיכות ועוד העברות נטו',
  nd: 'צבירה נטו: הפקדות פחות משיכות ועוד העברות נטו (NET_MONTHLY_DEPOSITS)',
  organic: 'צבירה אורגנית: הפקדות פחות משיכות, בלי העברות',
  transfers: 'ניוד נטו: העברות נכנסות פחות העברות יוצאות',
};

/** one line under a table header: which flow measure the table shows, with the definitions one click away */
export function FlowDef({ kinds, className = '' }: { kinds: FlowKind[]; className?: string }) {
  return (
    <div className={`flowdef ${className}`.trim()}>
      {kinds.map((k) => <span key={k}>{FLOW_DEF[k]}</span>)}
      <Link to="/methodology#flows">הגדרות התזרימים</Link>
    </div>
  );
}

/** the intra-group migration flag on a track row that carries one (funds.json `mig`) */
export function MigChip({ f, flowSrc }: { f: FundX; flowSrc?: () => Prov }) {
  if (!f.mig) return null;
  const m = f.mig;
  return <Sourced className="chip est mig" src={() => migProv({ ...f, mig: m }, flowSrc)} title={MIG_HE}>{MIG_HE}</Sourced>;
}

/** the plausibility marker on an exposure share the regulator published outside the range (funds.json `chk`) */
export function CheckChip({ keys, src }: { keys: ('st' | 'fo' | 'fx')[]; src?: () => Prov }) {
  if (!keys.length) return null;
  const label = `${CHECK_HE}: ${keys.map((k) => EXP_LABEL[k]).join(', ')}`;
  return src ? <Sourced className="chip review" src={src} title={CHECK_WHY}>{label}</Sourced> : <span className="chip review" title={CHECK_WHY}>{label}</span>;
}
