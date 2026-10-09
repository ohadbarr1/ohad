/** The fox mark: a phoenix rising. Wings, body and tail are separate groups so the mark can animate. */
export function Logo({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg className={`logo${animated ? ' logo-live' : ''}`} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="fox">
      <defs>
        <linearGradient id="fox-g" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#ffcf5c" /><stop offset="0.42" stopColor="#ff7a2f" /><stop offset="1" stopColor="#e0218a" />
        </linearGradient>
      </defs>
      <g fill="url(#fox-g)">
        <path className="wing wl" d="M30.5 31 C24 29 15 23 7 8 C14 13 20 15 26 17 C22 17 18 16.5 14.5 15.5 C19 20 24 22 28.5 23.5 C25.5 24 22.5 23.8 20 23.2 C23.5 27 27 29 30.5 31 Z" />
        <path className="wing wr" d="M33.5 31 C40 29 49 23 57 8 C50 13 44 15 38 17 C42 17 46 16.5 49.5 15.5 C45 20 40 22 35.5 23.5 C38.5 24 41.5 23.8 44 23.2 C40.5 27 37 29 33.5 31 Z" />
        <g className="body">
          <path d="M33.2 15.5 C34.6 18 34.2 21 33.4 24 C35.6 29 35 35 32 40 C29 35 28.4 29 30.6 24 C30 21.5 30 19 30.8 17 Z" />
          <path d="M30.6 17.4 C30 14.6 31.6 12.4 34 12.2 C35.8 12.1 37.2 13 37.8 14.4 L41.4 15.6 L37.6 16.6 C36.8 17.8 35.2 18.4 33.6 18.2 C32.4 18 31.2 17.8 30.6 17.4 Z" />
          <path d="M31.4 13.2 C29.6 11 29.4 8.4 30.8 6 C31 8.4 31.8 10.4 33.4 12.2 Z" />
          <path d="M30.2 14.6 C27.8 13.6 26.4 11.6 26.2 9 C27.4 11 28.8 12.4 30.8 13.4 Z" />
        </g>
        <g className="tail">
          <path d="M31.2 38 C29.6 45 25 50.5 16.5 56.5 C25.5 55.5 31 51 32 43 Z" />
          <path d="M32.8 38 C34.4 45 39 50.5 47.5 56.5 C38.5 55.5 33 51 32 43 Z" />
          <path d="M32 40 C30.6 47 30.8 53.5 32 60 C33.2 53.5 33.4 47 32 40 Z" />
        </g>
      </g>
      <circle cx="34.6" cy="14.6" r="0.75" fill="var(--bg)" />
    </svg>
  );
}
