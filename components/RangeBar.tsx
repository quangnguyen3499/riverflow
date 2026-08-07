import { formatPrice } from '@/lib/format';

/**
 * Minimum (high − low) / price worth drawing as a bar. Below this the end labels print the same
 * number and the marker is noise. Measured on the live crypto-only table: UUSDT is inside the
 * visible 50 at a 0.030% spread on $9.3M of volume (low 1.00050, high 1.00080). The dollar proxies
 * that also tripped it (USDC 0.03%, USD1 0.03%, RLUSD 0.05%, FDUSD 0.05%, EUR 0.32%) are gone from
 * the table under the crypto-only filter; U is a crypto asset and stays.
 */
const MIN_RANGE_SPREAD = 0.0025;
const MIN_RANGE_SPREAD_LABEL = `${(MIN_RANGE_SPREAD * 100).toFixed(2)}%`;

/**
 * 24h low → high track with a marker at the last price. No hooks and no 'use client' needed: pure
 * props in, markup out. Its parent row is already a client component.
 */
export function RangeBar({
  low,
  high,
  price,
  className = '',
}: {
  low: number;
  high: number;
  price: number;
  className?: string;
}) {
  const span = high - low;
  // A near-flat day is not a range. Zero/inverted span (a freshly listed pair) and any span under
  // MIN_RANGE_SPREAD both render the muted flat track — the same no-data language the Sparkline
  // uses — rather than a marker positioned by rounding error between two identical labels.
  const flat = !(span > 0) || !(price > 0) || span / price < MIN_RANGE_SPREAD;

  if (flat) {
    return (
      <div
        className={`flex flex-col gap-1 ${className}`}
        role="img"
        aria-label={`24 hour range is flat within ${MIN_RANGE_SPREAD_LABEL}, last ${formatPrice(price)}`}
        title={`24h range under ${MIN_RANGE_SPREAD_LABEL} — low ${formatPrice(low)} · high ${formatPrice(high)}`}
      >
        {/* Same two-row box and the same total height as the live bar, so no row reflows. */}
        <div className="relative h-1 w-full">
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
        </div>
        <div className="flex justify-center text-[10px] leading-none tabular-nums text-muted">
          <span>—</span>
        </div>
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, ((price - low) / span) * 100));

  return (
    <div
      className={`flex flex-col gap-1 ${className}`}
      role="img"
      aria-label={`24 hour range ${formatPrice(low)} to ${formatPrice(high)}, last ${formatPrice(price)}`}
      title={`24h low ${formatPrice(low)} · high ${formatPrice(high)}`}
    >
      <div className="relative h-1 w-full rounded-full bg-border">
        {/* Filled portion: low → last price. Deliberately neutral, never green/red — direction is
            the 24h % column's job, and two colour languages in one row compete with each other. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-muted"
          style={{ width: `${pct}%` }}
        />
        {/* Marker: 2px wide, offset by half its width so it sits ON the position, not beside it. */}
        <div
          className="absolute top-[-2px] h-[8px] w-[2px] rounded-sm bg-text"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] leading-none tabular-nums text-muted">
        <span>{formatPrice(low)}</span>
        <span>{formatPrice(high)}</span>
      </div>
    </div>
  );
}
