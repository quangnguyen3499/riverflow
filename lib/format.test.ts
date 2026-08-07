import { describe, expect, it } from 'vitest';
import { formatCompact, formatPercent, formatPrice, formatUsd } from '@/lib/format';

describe('formatPrice', () => {
  it('formats values >= 1 with thousands separators and exactly 2 decimals', () => {
    expect(formatPrice(67241.5)).toBe('67,241.50');
    expect(formatPrice(1)).toBe('1.00');
    expect(formatPrice(1234567.894)).toBe('1,234,567.89');
  });

  it('formats values < 1 with 4 significant digits', () => {
    expect(formatPrice(0.612)).toBe('0.6120');
    expect(formatPrice(0.5)).toBe('0.5000');
    expect(formatPrice(0.09876)).toBe('0.09876');
  });

  it('formats zero as 0.00', () => {
    expect(formatPrice(0)).toBe('0.00');
  });
});

describe('formatPercent', () => {
  it('always shows a sign and 2 decimals', () => {
    expect(formatPercent(4.2)).toBe('+4.20%');
    expect(formatPercent(-1.1)).toBe('-1.10%');
    expect(formatPercent(0)).toBe('+0.00%');
  });
});

describe('formatCompact', () => {
  it('abbreviates trillions, billions, millions, and thousands to 1 decimal', () => {
    expect(formatCompact(1_320_000_000_000)).toBe('1.3T');
    expect(formatCompact(28_100_000_000)).toBe('28.1B');
    expect(formatCompact(6_200_000)).toBe('6.2M');
    expect(formatCompact(981_400)).toBe('981.4K');
  });

  it('keeps values below 1000 at 2 decimals', () => {
    expect(formatCompact(999)).toBe('999.00');
    expect(formatCompact(0)).toBe('0.00');
  });
});

describe('formatUsd', () => {
  it('prefixes formatPrice with $', () => {
    expect(formatUsd(67241.5)).toBe('$67,241.50');
    expect(formatUsd(0.612)).toBe('$0.6120');
  });
});
