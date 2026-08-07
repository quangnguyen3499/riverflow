'use client';

import { useState } from 'react';
import { COIN_ICONS } from '@/lib/coin-icons';

/** Brand-neutral avatar hues. Deliberately contains NO green and NO red —
 *  those two colours mean "up" and "down" everywhere else in this UI. */
const AVATAR_HUES = [
  '#475569', '#4f46e5', '#0d9488', '#7c3aed',
  '#0369a1', '#a16207', '#be185d', '#3f3f46',
] as const;

function hueFor(symbol: string): string {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_HUES[Math.abs(h) % AVATAR_HUES.length];
}

/**
 * First ALPHABETIC character, not first character. Some exchanges denominate thin-priced memecoins with a
 * numeric multiplier prefix — 1000SATS, 1000CAT, 1MBABYDOGE — and `slice(0, 1)` renders those as a
 * circle containing "1": meaningless, and identical for all of them. "S" is the right letter for
 * 1000SATS. The numeric fallback (a purely numeric ticker) is KEPT.
 *
 * This only ever sees [A-Z0-9]: Task 11's `isCryptoBase` drops any base that is not plain
 * alphanumeric, which is what keeps 币安人生USDT ("Market Life", live today) from rendering a CJK
 * glyph at 11px inside a 24px circle.
 */
function avatarLetter(ticker: string): string {
  const match = /[A-Z]/.exec(ticker);
  return match ? match[0] : ticker.slice(0, 1);
}

export function CoinIcon({
  symbol,
  size = 24,
  className = '',
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const lower = symbol.toLowerCase();
  const src = `/coins/${lower}.svg`;
  // Track the src that FAILED, not a boolean: a symbol change then automatically re-arms the
  // <img>. The obvious useState(false) implementation ships a bug where a recycled row that
  // switches symbol inherits the previous symbol's failure and never shows its real icon.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!COIN_ICONS.has(lower) || failedSrc === src) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white select-none ${className}`}
        style={{
          width: size,
          height: size,
          background: hueFor(symbol.toUpperCase()),
          fontSize: Math.round(size * 0.44),
        }}
      >
        {avatarLetter(symbol.toUpperCase())}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""                       // decorative: the row already prints the name and ticker
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={`shrink-0 rounded-full ${className}`}
    />
  );
}
