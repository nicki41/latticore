/**
 * Latticore's mark (design board "Panel Rebrand – Name & Logo"): a cube made
 * of nodes — servers — woven together. Two drawings of the same cube:
 *  - "lattice": the full wireframe with a node at every vertex, for anything
 *    shown at roughly 40px and up (auth screens, splash, app icons).
 *  - "compact": the solid three-face cube, which stays legible at 16–32px
 *    (sidebar, favicon) where the wireframe's lines would turn to mush.
 */
const PETAL = "#F5B6D2";
const BLOOM = "#E26AA0";
const ROSE = "#B8286E";

const NODES: [number, number][] = [
  [32, 8],
  [53, 20],
  [53, 44],
  [32, 56],
  [11, 44],
  [11, 20],
  [32, 32],
];

export function Logo({ className, variant = "compact" }: { className?: string; variant?: "compact" | "lattice" }) {
  if (variant === "lattice") {
    return (
      <svg viewBox="0 0 64 64" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g stroke={PETAL} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" fill="none">
          <path d="M32 8 L53 20 L53 44 L32 56 L11 44 L11 20 Z" />
          <path d="M11 20 L32 32 L53 20 M32 32 L32 56" />
        </g>
        {NODES.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" fill={BLOOM} />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="8 6 48 52" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M32 8 L53 20 L32 32 L11 20 Z" fill={PETAL} />
      <path d="M11 20 L32 32 L32 56 L11 44 Z" fill={ROSE} />
      <path d="M53 20 L32 32 L32 56 L53 44 Z" fill={BLOOM} />
    </svg>
  );
}

/** "latticore" — "core" in the accent color, mirroring how the mark puts its brightest node at the center. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      latti<span className="text-primary">core</span>
    </span>
  );
}
