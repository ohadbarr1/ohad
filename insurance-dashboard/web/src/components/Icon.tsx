const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  companies: 'M4 21V5l8-2v18M12 9l8 2v10M8 8v0M8 12v0M8 16v0M16 14v0M16 18v0M2 21h20',
  compare: 'M5 20V10M10 20V4M15 20v-7M20 20V8',
  value: 'M4 4h16v16H4zM8 8h8M8 12h3M13 12h3M8 16h3M13 16h3',
  market: 'M3 17l5-6 4 3 4-7 5 5M3 21h18',
  funds: 'M12 3l9 5-9 5-9-5 9-5M3 13l9 5 9-5M3 18l9 5 9-5',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8',
  palette: 'M12 3a9 9 0 100 18c1.2 0 2-.9 2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.2 1-2.2 2.2-2.2H17a4 4 0 004-4c0-3.9-4-7-9-7zM7.5 12v0M10 8v0M14.5 8v0',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5',
};
export function Icon({ name }: { name: keyof typeof P | string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={P[name]} /></svg>;
}
