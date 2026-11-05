import { Icon } from '../Icon';

/* W1 shell: the few glyphs the three doors need beyond the house set (components/Icon.tsx), drawn in the same language: a 24-px
   duotone, a soft fill (.f) under a 1.6-px stroke (.s). Kept here so the shared icon file stays untouched by this lane. */
type Glyph = { f?: string; s: string };
const X: Record<string, Glyph> = {
  fee: { f: 'M12 3a9 9 0 100 18 9 9 0 000-18z', s: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 15l6-6M9.5 8.3a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zM14.5 13.3a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z' },
  eye: { f: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z', s: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 9a3 3 0 100 6 3 3 0 000-6z' },
  briefcase: { f: 'M3 8h18v12H3z', s: 'M3 8h18v12H3zM9 8V5h6v3M3 13.5h18M11 13.5v2h2v-2' },
  terminal: { f: 'M3 5h18v14H3z', s: 'M3 5h18v14H3zM17 10l-3 2 3 2M12 15H7' },
  arrow: { s: 'M19 12H5M11 6l-6 6 6 6' },
  doors: { f: 'M4 4h7v7H4zM13 13h7v7h-7z', s: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  // P0 shell (05.11.26): the agent's clients, the saver's moments, the Pro library
  clients: { f: 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6z', s: 'M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15.5 4.8a3.2 3.2 0 010 6.4M17.5 14.3c2 .7 3.5 2.9 3.5 5.7' },
  moment: { f: 'M5 4h13l-2.6 4L18 12H5z', s: 'M5 21V4h13l-2.6 4L18 12H5' },
  library: { f: 'M3.5 4h4v16h-4zM9.5 4h4v16h-4z', s: 'M3.5 4h4v16h-4zM9.5 4h4v16h-4zM15.4 5.6l3.6-1 3.4 13.4-3.6 1zM3.5 8h4M9.5 8h4' },
};

/** A house glyph, or one of the door glyphs above; the same markup and classes as <Icon>, so every rule that styles `svg.ico` applies. */
export function Ico({ name, size, tone, className }: { name: string; size?: number; tone?: 'ember' | 'ink'; className?: string }) {
  const g = X[name];
  if (!g) return <Icon name={name} size={size} tone={tone} className={className} />;
  return (
    <svg className={`ico${tone ? ` ${tone}` : ''}${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {g.f && <path className="f" d={g.f} />}
      <path className="s" d={g.s} />
    </svg>
  );
}
