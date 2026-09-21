// Glass pipe illustration: NAV flows through the pipes, a clean value passes the
// guard valve, a stale value is held at the gate.

const MAIN =
  "M 150 -40 L 150 150 Q 150 200 200 200 L 420 200 Q 470 200 470 250 L 470 400 Q 470 450 420 450 L 300 450 Q 250 450 250 500 L 250 760";
const LOOP =
  "M 470 300 L 600 300 Q 650 300 650 350 L 650 560 Q 650 610 600 610 L 250 610";

function Glass({ d }: { d: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="rgba(120,132,170,0.16)" strokeWidth={50} transform="translate(10 18)" />
      <path d={d} stroke="#d9dde8" strokeWidth={46} />
      <path d={d} stroke="#f7f8fc" strokeWidth={40} />
      <path d={d} stroke="url(#glassSheen)" strokeWidth={40} opacity={0.9} />
      <path d={d} stroke="rgba(255,255,255,0.95)" strokeWidth={5} transform="translate(-9 -9)" />
    </g>
  );
}

function Joint({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x={-34} y={-26} width={68} height={52} rx={10} fill="url(#blueBody)" />
      <rect x={-26} y={-34} width={52} height={68} rx={10} fill="url(#blueBody)" />
      <ellipse cx={0} cy={-34} rx={26} ry={8} fill="#6f7dff" />
      <ellipse cx={0} cy={-34} rx={17} ry={4.5} fill="#2f3fd9" />
      <rect x={-34} y={-26} width={68} height={10} rx={5} fill="rgba(255,255,255,0.22)" />
    </g>
  );
}

function Collar({ x, y, vertical = true }: { x: number; y: number; vertical?: boolean }) {
  return vertical ? (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-29} y={-22} width={58} height={44} rx={8} fill="url(#blueBody)" />
      <ellipse cx={0} cy={-22} rx={29} ry={9} fill="#7d89ff" />
      <ellipse cx={0} cy={-22} rx={19} ry={5} fill="#2f3fd9" />
    </g>
  ) : (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-22} y={-29} width={44} height={58} rx={8} fill="url(#blueBody)" />
      <ellipse cx={-22} cy={0} rx={9} ry={29} fill="#7d89ff" />
      <ellipse cx={-22} cy={0} rx={5} ry={19} fill="#2f3fd9" />
    </g>
  );
}

export default function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 760 720" role="img" aria-label="NAV flowing through glass pipes and a guard valve">
      <defs>
        <linearGradient id="glassSheen" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#e9ecf6" stopOpacity="0.4" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id="blueBody" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#5a6bff" />
          <stop offset="1" stopColor="#2c3bd6" />
        </linearGradient>
        <radialGradient id="ball" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#6b7080" />
          <stop offset="0.45" stopColor="#23262f" />
          <stop offset="1" stopColor="#0c0d12" />
        </radialGradient>
        <radialGradient id="ballBlue" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#9aa4ff" />
          <stop offset="0.5" stopColor="#3e4ff0" />
          <stop offset="1" stopColor="#2331b8" />
        </radialGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      <g transform="rotate(-8 380 360)">
        <Glass d={LOOP} />
        <Glass d={MAIN} />

        {/* input block, like a feed tank at the top of the reference */}
        <rect x={92} y={-60} width={116} height={78} rx={14} fill="url(#blueBody)" />
        <rect x={92} y={-60} width={116} height={16} rx={8} fill="rgba(255,255,255,0.22)" />

        <Joint x={470} y={300} />
        <Joint x={250} y={610} />
        <Collar x={150} y={118} />
        <Collar x={650} y={420} />
        <Collar x={250} y={690} />

        {/* the guard valve: a blue gate across the main pipe */}
        <g transform="translate(470 360)">
          <rect x={-46} y={-14} width={92} height={28} rx={9} fill="url(#blueBody)" />
          <rect x={-46} y={-14} width={92} height={7} rx={3.5} fill="rgba(255,255,255,0.28)" />
          <circle cx={0} cy={0} r={34} fill="none" stroke="#3e4ff0" strokeOpacity={0.25} strokeWidth={2}>
            <animate attributeName="r" values="30;46;30" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.35;0;0.35" dur="2.6s" repeatCount="indefinite" />
          </circle>
        </g>

        {/* stale value held at the gate */}
        <circle cx={470} cy={326} r={16} fill="url(#ball)" />

        {/* clean value flowing through the loop */}
        <circle r={15} fill="url(#ballBlue)">
          <animateMotion dur="7s" repeatCount="indefinite" path={LOOP} rotate="auto" />
        </circle>
        <circle r={15} fill="url(#ball)">
          <animateMotion dur="7s" begin="-3.5s" repeatCount="indefinite" path={MAIN} keyPoints="0;0.42" keyTimes="0;1" calcMode="linear" />
        </circle>
      </g>
    </svg>
  );
}
