import { describe, expect, it } from 'vitest';
import { COIN_NAMES, coinLabel, coinName } from '@/lib/coin-names';

/** Assets whose display name legitimately IS their ticker. Any other key whose value
 *  equals the key is an unfinished stub, which is what the hygiene test below catches. */
const SELF_TITLED = new Set(['BNB', 'XRP', 'GMX', 'ORDI', 'NEO', 'IOTA', 'U', 'COTI']);

describe('coinName', () => {
  it('resolves a known base asset given in lowercase', () => {
    expect(coinName('btc')).toBe('Bitcoin');
    expect(coinName('eth')).toBe('Ethereum');
    expect(coinName('1inch')).toBe('1inch');
  });

  it('resolves a known base asset given in uppercase', () => {
    expect(coinName('BTC')).toBe('Bitcoin');
    expect(coinName('SHIB')).toBe('Shiba Inu');
    expect(coinName('FET')).toBe('Artificial Superintelligence Alliance');
    // Added because it was rendering as a bare ticker on a top-5 row of the live table.
    expect(coinName('era')).toBe('Caldera');
    expect(coinName('1000sats')).toBe('SATS (1000x)');
  });

  it('falls back to the uppercase ticker for an unmapped asset', () => {
    expect(coinName('zzz')).toBe('ZZZ');
    expect(coinName('NEWLISTING')).toBe('NEWLISTING');
    expect(coinName('')).toBe('');
  });
});

describe('COIN_NAMES', () => {
  it('has an uppercase key and a non-stub display name for every entry', () => {
    const stubs: string[] = [];
    for (const [key, value] of Object.entries(COIN_NAMES)) {
      expect(key).toBe(key.toUpperCase());
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
      if (value === key && !SELF_TITLED.has(key)) stubs.push(key);
    }
    expect(stubs).toEqual([]);
    expect(Object.keys(COIN_NAMES).length).toBeGreaterThan(120);
  });

  it('does not carry entries for assets with no live USDT market', () => {
    // Measured against the live TRADING USDT set: every one of these matches nothing.
    // OM in particular is MANTRA's RETIRED ticker; the live one is MANTRA.
    for (const dead of ['TON', 'MATIC', 'MKR', 'FTM', 'EOS', 'LRC', 'KDA', 'OM', 'DAI', 'WAVES', 'OCEAN', 'HIGH']) {
      expect(COIN_NAMES[dead]).toBeUndefined();
    }
    expect(COIN_NAMES.MANTRA).toBe('MANTRA Chain');
  });
});

describe('coinLabel', () => {
  it('prints the display name first and the ticker second when the coin is named', () => {
    expect(coinLabel({ symbol: 'btc', name: 'Bitcoin', pair: 'BTCUSDT' })).toEqual({
      primary: 'Bitcoin',
      secondary: 'BTC',
    });
  });

  it('never prints the ticker twice: the fallback row shows the market pair as its second line', () => {
    // coinName fell back, so name === the uppercase ticker. The naive row renders "ERA  ERA",
    // which reads as a rendering bug. Measured coverage: this fires on ~0-10% of VISIBLE rows but
    // ~40% of the full store, so the palette and deep links are where it earns its keep.
    const label = coinLabel({ symbol: 'era', name: 'ERA', pair: 'ERAUSDT' });
    expect(label).toEqual({ primary: 'ERA', secondary: 'ERA/USDT' });
    expect(label.primary).not.toBe(label.secondary);
    // A genuinely self-titled asset takes the same, correct path.
    expect(coinLabel({ symbol: 'bnb', name: 'BNB', pair: 'BNBUSDT' })).toEqual({
      primary: 'BNB',
      secondary: 'BNB/USDT',
    });
  });
});
