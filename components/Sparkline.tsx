const MID = 16; // half of the 32-unit viewBox height

export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) {
    return (
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className={className}
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={MID}
          x2="100"
          y2={MID}
          stroke="var(--color-muted)"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;

  // 1.5 → 30.5 rather than 0 → 32: with non-scaling-stroke the extremes would otherwise be
  // clipped by half a stroke width at the top and bottom of the box.
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = range === 0 ? MID : 1.5 + (1 - (v - min) / range) * 29;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  // Coloured by the 7-DAY move, because that is the series this line draws.
  //
  // The old rule here — "a sparkline that disagrees with the percentage next to it is a bug" — was
  // self-contradictory and is deleted. The adjacent column is a 24h change; these two windows
  // disagree constantly and correctly (a coin down 3% today inside a week that is up 20% is an
  // ordinary Tuesday). Enforcing agreement would mean colouring a 7-day line by a 24h number, so the
  // line would contradict ITSELF. The fix is labelling: the Watchlist column header reads "7d"
  // (Task 21), which makes the two windows visibly different measurements.
  const up = points[points.length - 1] >= points[0];

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <polyline
        points={path}
        fill="none"
        stroke={up ? 'var(--color-up)' : 'var(--color-down)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
