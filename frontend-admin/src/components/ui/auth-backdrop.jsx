// Backdrop for the logged-out pages: engineering grid, two glow blobs and a few circuit traces with pulsing nodes.
// Pure CSS + one inline SVG (no image assets). Kept faint on purpose so the form text stays fully readable.
const TRACES = [
  // left-hand traces
  'M0 210 H150 L200 160 H330', 'M0 470 H110 L160 520 H290', 'M70 0 V110 L120 160', 'M40 900 V760 L90 710 H240',
  // right-hand traces (mirrored)
  'M1440 250 H1290 L1240 200 H1110', 'M1440 520 H1330 L1280 570 H1150', 'M1370 0 V120 L1320 170', 'M1400 900 V800 L1350 750 H1210',
];
const NODES = [[330, 160], [290, 520], [120, 160], [240, 710], [1110, 200], [1150, 570], [1320, 170], [1210, 750]];

export function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: 'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 45%, #000 0%, transparent 78%)',
          maskImage: 'radial-gradient(ellipse at 50% 45%, #000 0%, transparent 78%)',
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl" style={{ background: 'radial-gradient(circle, var(--accent-primary), transparent 65%)' }} />
      <div className="absolute -right-24 bottom-0 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(circle, var(--accent-secondary), transparent 65%)' }} />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none">
        <g stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" style={{ filter: 'drop-shadow(0 0 4px var(--accent-primary))' }}>
          {TRACES.map((d) => <path key={d} d={d} />)}
        </g>
        <g fill="var(--accent-primary)" style={{ filter: 'drop-shadow(0 0 6px var(--accent-primary))' }}>
          {NODES.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" className="node-pulse" style={{ animationDelay: `${i * 0.4}s` }} />)}
        </g>
      </svg>
    </div>
  );
}
