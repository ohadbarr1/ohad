import type { ReactNode } from 'react';

/* Isometric icons built from extruded blocks and discs. Three shades per material: top, left face, right face. */
type Mat = 'navy' | 'orange' | 'blue' | 'white';
const M: Record<Mat, [string, string, string]> = {
  navy: ['#40507F', '#1E2B58', '#111C3F'], orange: ['#FF9A80', '#FF4E31', '#D6391E'], blue: ['#DCE5F2', '#8FA8CC', '#6F8DB9'], white: ['#FFFFFF', '#E8ECF4', '#CBD3E2'],
};
const C = Math.cos(Math.PI / 6), S = 0.5;
const pt = (x: number, y: number, z: number): string => `${(50 + (x - y) * C).toFixed(1)},${(62 + (x + y) * S - z).toFixed(1)}`;

function Box({ x, y, w, d, z = 0, h, mat }: { x: number; y: number; w: number; d: number; z?: number; h: number; mat: Mat }) {
  const [top, left, right] = M[mat], t = z + h;
  return (
    <g>
      <polygon fill={left} points={[pt(x, y + d, z), pt(x + w, y + d, z), pt(x + w, y + d, t), pt(x, y + d, t)].join(' ')} />
      <polygon fill={right} points={[pt(x + w, y, z), pt(x + w, y + d, z), pt(x + w, y + d, t), pt(x + w, y, t)].join(' ')} />
      <polygon fill={top} points={[pt(x, y, t), pt(x + w, y, t), pt(x + w, y + d, t), pt(x, y + d, t)].join(' ')} />
    </g>
  );
}
function Disc({ cy, r = 26, h = 8, mat }: { cy: number; r?: number; h?: number; mat: Mat }) {
  const [top, left, right] = M[mat], ry = r * 0.5, id = `d${mat}${cy}`;
  return (
    <g>
      <defs><linearGradient id={id} x1="0" x2="1"><stop offset="0" stopColor={left} /><stop offset="1" stopColor={right} /></linearGradient></defs>
      <path fill={`url(#${id})`} d={`M${50 - r},${cy} v${h} a${r},${ry} 0 0 0 ${2 * r},0 v${-h} z`} />
      <ellipse cx={50} cy={cy} rx={r} ry={ry} fill={top} />
      <ellipse cx={50} cy={cy} rx={r * 0.62} ry={ry * 0.62} fill="none" stroke={left} strokeWidth={1.4} opacity={0.55} />
    </g>
  );
}

const ART: Record<string, ReactNode> = {
  home: <>
    <Box x={-20} y={-20} w={40} d={40} h={22} mat="white" />
    <polygon fill={M.orange[1]} points={[pt(-24, 24, 22), pt(24, 24, 22), pt(0, 24, 50)].join(' ')} />
    <polygon fill={M.orange[2]} points={[pt(24, -24, 22), pt(24, 24, 22), pt(0, 24, 50), pt(0, -24, 50)].join(' ')} />
    <polygon fill={M.navy[2]} points={[pt(-6, 20, 0), pt(6, 20, 0), pt(6, 20, 14), pt(-6, 20, 14)].join(' ')} />
  </>,
  companies: <>
    <Box x={-26} y={-18} w={24} d={24} h={56} mat="navy" />
    <Box x={2} y={-6} w={22} d={22} h={30} mat="orange" />
    <Box x={-14} y={12} w={18} d={14} h={14} mat="blue" />
  </>,
  compare: <>
    <Box x={-30} y={-8} w={16} d={16} h={20} mat="blue" />
    <Box x={-9} y={-8} w={16} d={16} h={38} mat="navy" />
    <Box x={12} y={-8} w={16} d={16} h={58} mat="orange" />
  </>,
  value: <>
    <Disc cy={66} mat="navy" /><Disc cy={55} mat="blue" /><Disc cy={44} mat="navy" /><Disc cy={33} mat="orange" />
  </>,
  market: <>
    <Box x={-28} y={-28} w={56} d={56} h={6} mat="white" />
    <Box x={-20} y={-20} w={18} d={18} z={6} h={14} mat="blue" />
    <Box x={2} y={-20} w={18} d={18} z={6} h={30} mat="navy" />
    <Box x={-20} y={2} w={18} d={18} z={6} h={24} mat="orange" />
    <Box x={2} y={2} w={18} d={18} z={6} h={10} mat="blue" />
  </>,
};

export function Icon3D({ name, size = 34 }: { name: string; size?: number }) {
  const art = ART[name];
  if (!art) return null;
  return (
    <svg className="i3d" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <ellipse className="i3d-shadow" cx={50} cy={88} rx={30} ry={6} />
      <g className="i3d-body">{art}</g>
    </svg>
  );
}

/** The home masthead scene: the five icons as one floating composition. */
export function Scene3D() {
  return (
    <div className="scene3d" aria-hidden="true">
      {(['companies', 'compare', 'value', 'market', 'home'] as const).map((n, i) => <span key={n} style={{ ['--i' as string]: i }}><Icon3D name={n} size={n === 'companies' ? 150 : 96} /></span>)}
    </div>
  );
}
