import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useOutletContext } from 'react-router-dom';
import { HubTabs } from '../components/HubTabs';
import { Icon } from '../components/Icon';
import { Toolbar } from '../components/ui';
import '../styles/prov-kpi.css';

/** The hub's toolbar row: the tabs at the start, then a view's sub-tabs (`lead`) and its controls (`end`), placed there by the view (design lane). */
export interface IndustryCtx { lead: HTMLElement | null; end: HTMLElement | null }
export function IndustryTools({ children, at = 'end' }: { children: ReactNode; at?: 'lead' | 'end' }) {
  const ctx = useOutletContext<IndustryCtx | undefined>();
  const el = ctx?.[at];
  return el ? createPortal(children, el) : null;
}

export function IndustryLayout() {
  const [lead, setLead] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  return (
    <>
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="compare" /></span>השוואה ענפית</h1></div></div>
      <Toolbar className="hubtools" lead={<>
        {/* wave 2b: the hub's tab row, shared with /capital and /restatements (components/HubTabs); investor presentations and the debt
            ladder are in the Pro door's library */}
        <HubTabs hub="industry" />
        <span ref={setLead} className="tools-slot" />
      </>}><span ref={setEnd} className="tools-slot" /></Toolbar>
      <Outlet context={{ lead, end } satisfies IndustryCtx} />
    </>
  );
}
