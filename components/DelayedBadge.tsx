import type { StocksDataMode } from '@/lib/types';

/**
 * Provenance badge for the stocks pages. Three states, all of them explicit:
 *
 *   `live`      → real end-of-day data      → "DELAYED · EOD"
 *   `fixture`   → synthetic sample data     → "SAMPLE DATA"
 *   `undefined` → the payload has not arrived yet, so claim nothing about the source
 *
 * Never hidden and never rendered without text. A stock number with no caveat beside it is the
 * one thing this component exists to prevent — and since the fixture is the DEFAULT source
 * (see lib/stocks-fixture.ts), the `fixture` wording is what most visitors will read.
 */
export function DelayedBadge({ mode }: { mode?: StocksDataMode }) {
  if (mode === 'fixture') {
    return (
      <span
        title="Sample data — synthetic prices generated for this demo. Not real quotes; these companies do not exist."
        className="rounded border border-border bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted"
      >
        SAMPLE DATA
      </span>
    );
  }

  if (mode === 'live') {
    return (
      <span
        title="End-of-day data — demo only. Not real-time. Not for trading decisions."
        className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent"
      >
        DELAYED · EOD
      </span>
    );
  }

  return (
    <span
      title="End-of-day data — stocks do not stream. Loading the session…"
      className="rounded border border-border bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted"
    >
      EOD
    </span>
  );
}
