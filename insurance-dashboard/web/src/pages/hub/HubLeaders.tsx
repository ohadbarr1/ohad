import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Scoreboard, type ScoreRowData } from '../../components/Scoreboard';
import { Takeaway } from '../../components/Takeaway';
import { PeriodSeg } from '../../components/PeriodSeg';
import { NumText } from '../../components/NumText';
import { CompareAdd } from '../../components/FundsNav';
import { IdDot } from '../../components/MgrChip';
import { Sourced } from '../../components/Source';
import { listP } from '../../lib/market';
import { nf } from '../../lib/format';
import { annual, pc, realOf, shownProv, useReal, type FundX, type Per } from '../../lib/funds';
import { useMacro } from '../../lib/macro';
import { leaderRows, scoreRows, typeGrid, typeMembers, typeWindowAvg } from '../../lib/pageMonths';
import { hubLeadIntro, inMonth, leadHeadSub, leaderLabel, perWords, tieNote, typeLabel } from '../../lib/pageWords';
import { trackColor, trackLabels } from '../compare/tracks';
import type { HubCtx } from './HubMonth';

/* The hub's "ראשונים ואחרונים" lens ("מובילים ומאספים" for the agent and Pro; rollout spec §6.2 #5, §17.1 2c, §18.6, T-H3): one small
   board per track type: the first, the reader's own track (saver door, when it is neither) and the last, with their places from the
   one ranking of the site (lib/pageMonths scoreRows → placeGroups: the same places as the screener and the type-month sheet), the count
   and the type's average. The saver sees the month and the grid's four types. The agent and Pro keep what the old hub had: the window
   (1M · LTM · 3Y · 5Y, `?win=`), the six largest types, the median, the manager's colour, a link to every track of the type, the
   add-to-compare "＋", and (Pro) the real return. A row opens the track's card. */

export const HUB_WINS: Per[] = ['m1', 'y12', 'a3', 'a5'];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

export function HubLeaders({ ctx, win, setWin }: { ctx: HubCtx; win: Per; setWin: (p: Per) => void }) {
  const { file, cats, asof, prod, door, saver, mineKeys, mineKey } = ctx;
  const nav = useNavigate();
  const cpi = useMacro().data;
  const [realPref, setReal] = useReal();
  const per: Per = saver ? 'm1' : win;
  const real = door === 'pro' && realPref;
  const C = cpi?.series.cpi;
  const types = useMemo(() => typeGrid(file.funds, cats, prod, { asof, mineKey, max: saver ? 4 : 6, n: 1 }).cols, [file, cats, prod, asof, mineKey, saver]);
  const boards = useMemo(() => types.map((c, ti) => {
    const base = typeMembers(file.funds, c.key);
    // Pro's real return: the same ranking function on the CPI-deflated figure of the window
    const mem = real ? base.map((f) => ({ ...f, [per]: realOf(f, per, 'gross', asof, C).v } as FundX)) : base;
    const scored = scoreRows(mem, per, { asof });
    const ranked = scored.filter((r) => r.ranked);
    const ls = trackLabels(ranked.map((x) => x.f)), labels = new Map(ranked.map((r, i) => [r.k, ls[i]]));
    const lr = leaderRows(scored, mineKeys);
    const avg = real ? null : per === 'm1' ? (() => { const cx = cats[c.key], i = cx ? cx.p.indexOf(asof) : -1; return i < 0 ? null : cx!.y[i] ?? null; })() : typeWindowAvg(cats[c.key], per as 'y12' | 'a3' | 'a5', asof);
    const med = median(ranked.map((r) => r.v as number));
    return { c, ti, ranked, labels, lr, avg, med, base, miss: base.filter((f) => !scored.find((r) => r.k === f.k)?.ranked).length };
  }), [types, file, per, real, asof, C, cats, mineKeys]);

  const dec = per === 'm1' ? 2 : 1;
  const intro = per === 'm1' ? hubLeadIntro(asof) : hubLeadIntro(asof).replace(inMonth(asof), perWords(per, asof));
  const anyShared = boards.some((b) => b.lr.some((x) => x.row.pl.shared));
  const screen = (key: string) => { const [p, t] = key.split(' | '); return `/funds/screen?${new URLSearchParams({ prod: p, track: t, per }).toString()}`; };
  const prov = (f: FundX) => () => shownProv(f, per, 'gross', real, asof, C, file);

  return (
    <div className="hub-lead">
      {!saver ? (
        <div className="hub-wins">
          <PeriodSeg door={door} value={per} onChange={setWin} asof={asof} periods={HUB_WINS} id="win-seg" />
          {door === 'pro' ? <button type="button" className="hub-real" aria-pressed={real} onClick={() => setReal(!realPref)}>ריאלי</button> : null}
        </div>
      ) : null}
      <Takeaway text={intro} />
      <div className="hub-boards">
        {boards.map(({ c, ti, ranked, labels, lr, avg, med, miss }) => {
          if (!lr.length) return null;
          const rows: ScoreRowData[] = lr.map(({ row, role, mine }) => ({
            k: row.k, label: labels.get(row.k) ?? row.f.name, color: trackColor(ti), value: row.v, place: row.pl.place,
            unit: annual(per) ? 'בשנה' : undefined, mine: saver && mine,
            sub: saver ? leaderLabel(role, saver && mine) : <span className="hub-mgr"><IdDot grp={row.f.grp} />{leaderLabel(role, false)}</span>,
          }));
          const isMine = saver && c.key === mineKey;
          const head = (
            <div className="hub-bh">
              <b>{typeLabel(c.track)}{isMine ? <span className="sb-mine">שלי</span> : null}</b>
              <span><NumText t={leadHeadSub(ranked.length, avg)} />
                {!saver && med != null ? <> · חציון <Sourced src={() => listP(`חציון · ${c.key}`, pc(med, dec), undefined, 'החציון של תשואות המסלולים המדורגים בסוג', ranked.map((r) => ({ label: r.f.name, v: pc(r.v, dec), src: prov(r.f) })))}><bdi dir="ltr" className="sgnum">{pc(med, dec)}</bdi></Sourced></> : null}
                {!saver && miss > 0 ? <> · <bdi dir="ltr" className="sgnum">{nf(miss, 0)}</bdi> לא מדורגים</> : null}
              </span>
              {!saver ? <Link className="hub-all" to={screen(c.key)}>לכל המסלולים ›</Link> : null}
            </div>
          );
          return (
            <Scoreboard key={c.key} id={`lead-${ti}`} rows={rows} decimals={dec} bars="none" mineWord={null} head={head}
              onOpen={(k) => nav(`/funds/${k}`)} trailing={saver ? undefined : (k) => <CompareAdd k={k} name={labels.get(k) ?? k} small />} />
          );
        })}
      </div>
      {anyShared ? <p className="hub-note"><NumText t={tieNote(per, asof)} /></p> : null}
    </div>
  );
}
