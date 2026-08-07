export function formatPrice(n: number): string {
  if (n === 0) return '0.00';
  if (Math.abs(n) >= 1) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return n.toLocaleString('en-US', {
    minimumSignificantDigits: 4,
    maximumSignificantDigits: 4,
  });
}

export function formatPercent(n: number): string {
  const sign = n < 0 ? '-' : '+';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

export function formatUsd(n: number): string {
  return `$${formatPrice(n)}`;
}
