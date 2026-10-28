/* The fox icon set: one language in both looks. Each glyph is a 24-px duotone — a soft fill (`.f`, currentColor at low opacity, or the
   ember on the active item) under a 1.6-px stroke — so icons read as objects with a little depth, not as wire outlines, without any
   raster or per-theme art. Nav: home, scenarios (three sliders), warroom (a crosshair), positions (a clipboard with a check); the
   evidence group: market, compare, value. Also data, mine. Sections: statement, csm (the CSM bridge), shield (solvency),
   filing, savings, search, calendar, book, companies, inbox (empty states), download, sliders. Payload: ~2 KB in the shell bundle. */
type Glyph = { f?: string; s: string };
const G: Record<string, Glyph> = {
  questions: { f: 'M4 5h16v11H10l-5 4v-4H4z', s: 'M4 5h16v11H10l-5 4v-4H4zM9.6 9.2a2.4 2.4 0 014.8 0c0 1.6-2.4 1.7-2.4 3.2M12 14.6v.2' },
  home: { f: 'M5 10l7-6 7 6v10H5z', s: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  compare: { f: 'M4 12h4v8H4zM10 4h4v16h-4zM16 9h4v11h-4z', s: 'M4 12h4v8H4zM10 4h4v16h-4zM16 9h4v11h-4z' },
  value: { f: 'M4 4h16v16H4z', s: 'M4 4h16v16H4zM8 8h8M8 12h3M13 12h3M8 16h3M13 16h3' },
  scenarios: { f: 'M6 14a2 2 0 100 4 2 2 0 000-4zM12 6a2 2 0 100 4 2 2 0 000-4zM18 11a2 2 0 100 4 2 2 0 000-4z', s: 'M6 3v11M6 18v3M12 3v3M12 10v11M18 3v8M18 15v6M6 14a2 2 0 100 4 2 2 0 000-4zM12 6a2 2 0 100 4 2 2 0 000-4zM18 11a2 2 0 100 4 2 2 0 000-4z' },
  warroom: { f: 'M12 4a8 8 0 100 16 8 8 0 000-16z', s: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 9a3 3 0 100 6 3 3 0 000-6zM12 2v4M12 18v4M2 12h4M18 12h4' },
  positions: { f: 'M6 5h12v16H6z', s: 'M9 3h6v4H9zM9 5H6v16h12V5h-3M9 13.5l2 2 4-4.5' },
  market: { f: 'M3 17l5-6 4 3 4-7 5 5v5H3z', s: 'M3 17l5-6 4 3 4-7 5 5M3 21h18' },
  funds: { f: 'M12 3l9 5-9 5-9-5z', s: 'M12 3l9 5-9 5-9-5 9-5M3 13l9 5 9-5M3 18l9 5 9-5' },
  data: { f: 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3S4 4.3 4 6z', s: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' },
  mine: { f: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20.5c.8-3.6 3.9-5.8 7.5-5.8s6.7 2.2 7.5 5.8z', s: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20.5c.8-3.6 3.9-5.8 7.5-5.8s6.7 2.2 7.5 5.8' },
  companies: { f: 'M4 21V5l8-2v18zM12 9l8 2v10h-8z', s: 'M4 21V5l8-2v18M12 9l8 2v10M2 21h20M8 8v.5M8 12v.5M8 16v.5M16 14v.5M16 18v.5' },
  sun: { f: 'M12 8a4 4 0 100 8 4 4 0 000-8z', s: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8' },
  moon: { f: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z', s: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5' },
  palette: { f: 'M12 3a9 9 0 100 18c1.2 0 2-.9 2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.2 1-2.2 2.2-2.2H17a4 4 0 004-4c0-3.9-4-7-9-7z', s: 'M12 3a9 9 0 100 18c1.2 0 2-.9 2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.2 1-2.2 2.2-2.2H17a4 4 0 004-4c0-3.9-4-7-9-7zM7.5 12v.5M10 8v.5M14.5 8v.5' },
  statement: { f: 'M6 3h8l4 4v14H6z', s: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6' },
  csm: { f: 'M3 14h4v6H3zM9 8h4v12H9zM15 11h4v9h-4z', s: 'M3 14h4v6H3zM9 8h4v12H9zM15 11h4v9h-4zM7 14h2M13 11h2' },
  shield: { f: 'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z', s: 'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6zM9 12l2 2 4-4' },
  filing: { f: 'M3 6h6l2 2h10v11H3z', s: 'M3 6h6l2 2h10v11H3zM3 10h18' },
  savings: { f: 'M12 3l9 5-9 5-9-5z', s: 'M12 3l9 5-9 5-9-5 9-5M3 13l9 5 9-5M3 18l9 5 9-5' },
  search: { f: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13z', s: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM20 20l-4.4-4.4' },
  calendar: { f: 'M4 9h16v11H4z', s: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4' },
  book: { f: 'M4 5h16v14H4z', s: 'M4 5h16v14H4zM8 15v-4M12 15V8M16 15v-2' },
  inbox: { f: 'M4 13h4l2 3h4l2-3h4v7H4z', s: 'M4 13h4l2 3h4l2-3h4M4 13l2.5-8h11L20 13v7H4z' },
  download: { f: 'M5 15h14v5H5z', s: 'M12 3v11M8 10l4 4 4-4M5 15v5h14v-5' },
  sliders: { s: 'M4 7h9M17 7h3M4 17h5M13 17h7M15 5a2 2 0 100 4 2 2 0 000-4zM11 15a2 2 0 100 4 2 2 0 000-4z' },
  check: { s: 'M5 12l4 4 10-10' },
  x: { s: 'M6 6l12 12M18 6L6 18' },
  spark: { f: 'M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7z', s: 'M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7z' },
};
export type IconName = keyof typeof G;

/** A duotone glyph. `tone="ember"` lights the fill in the accent (an active place, a section lead); the stroke follows `currentColor`. */
export function Icon({ name, size, tone, className }: { name: IconName | string; size?: number; tone?: 'ember' | 'ink'; className?: string }) {
  const g = G[name] ?? G.inbox;
  return (
    <svg className={`ico${tone ? ` ${tone}` : ''}${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {g.f && <path className="f" d={g.f} />}
      <path className="s" d={g.s} />
    </svg>
  );
}
