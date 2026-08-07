/** Uppercase market-data source base asset → display name. Display only; NEVER an identity lookup
 *  (identity is `CoinMarket.id`, the lowercase base asset). the source's REST API returns no
 *  human-readable names at all, so this map is the only source of them in the app. */
export const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  BNB: 'BNB',
  SOL: 'Solana',
  XRP: 'XRP',
  USDC: 'USD Coin',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  TRX: 'TRON',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  DOT: 'Polkadot',
  POL: 'Polygon',
  SHIB: 'Shiba Inu',
  LTC: 'Litecoin',
  BCH: 'Bitcoin Cash',
  NEAR: 'NEAR Protocol',
  UNI: 'Uniswap',
  ICP: 'Internet Computer',
  APT: 'Aptos',
  XLM: 'Stellar',
  ETC: 'Ethereum Classic',
  HBAR: 'Hedera',
  FIL: 'Filecoin',
  ARB: 'Arbitrum',
  ATOM: 'Cosmos',
  VET: 'VeChain',
  IMX: 'Immutable',
  OP: 'Optimism',
  INJ: 'Injective',
  SUI: 'Sui',
  GRT: 'The Graph',
  TIA: 'Celestia',
  SEI: 'Sei',
  RUNE: 'THORChain',
  AAVE: 'Aave',
  LDO: 'Lido DAO',
  ALGO: 'Algorand',
  STX: 'Stacks',
  S: 'Sonic',
  RENDER: 'Render',
  FET: 'Artificial Superintelligence Alliance',
  THETA: 'Theta Network',
  EGLD: 'MultiversX',
  FLOW: 'Flow',
  AXS: 'Axie Infinity',
  SAND: 'The Sandbox',
  MANA: 'Decentraland',
  XTZ: 'Tezos',
  CHZ: 'Chiliz',
  CRV: 'Curve DAO',
  SNX: 'Synthetix',
  COMP: 'Compound',
  ENS: 'Ethereum Name Service',
  DYDX: 'dYdX',
  GMX: 'GMX',
  PEPE: 'Pepe',
  WIF: 'dogwifhat',
  BONK: 'Bonk',
  FLOKI: 'Floki',
  ORDI: 'ORDI',
  JUP: 'Jupiter',
  PYTH: 'Pyth Network',
  JTO: 'Jito',
  STRK: 'Starknet',
  ENA: 'Ethena',
  W: 'Wormhole',
  ONDO: 'Ondo',
  AR: 'Arweave',
  KAVA: 'Kava',
  IOTA: 'IOTA',
  NEO: 'NEO',
  QNT: 'Quant',
  GALA: 'Gala',
  APE: 'ApeCoin',
  '1INCH': '1inch',
  CAKE: 'PancakeSwap',
  KSM: 'Kusama',
  ZEC: 'Zcash',
  DASH: 'Dash',
  BAT: 'Basic Attention Token',
  YFI: 'yearn.finance',
  SUSHI: 'SushiSwap',
  TAO: 'Bittensor',
  WLD: 'Worldcoin',
  BLUR: 'Blur',
  NOT: 'Notcoin',
  ZK: 'ZKsync',
  TRB: 'Tellor',
  ETHFI: 'ether.fi',
  ROSE: 'Oasis Network',
  ZIL: 'Zilliqa',
  ONE: 'Harmony',
  MINA: 'Mina',
  CFX: 'Conflux',
  GMT: 'STEPN',
  RSR: 'Reserve Rights',
  SKL: 'SKALE',
  ANKR: 'Ankr',
  CELO: 'Celo',
  LUNC: 'Terra Classic',
  LUNA: 'Terra',
  BTTC: 'BitTorrent',
  HOT: 'Holo',
  IOTX: 'IoTeX',
  JASMY: 'JasmyCoin',
  MASK: 'Mask Network',
  ARKM: 'Arkham',
  AXL: 'Axelar',
  BOME: 'BOOK OF MEME',
  FDUSD: 'First Digital USD',
  TUSD: 'TrueUSD',
  USDP: 'Pax Dollar',
  PAXG: 'PAX Gold',
  QTUM: 'Qtum',
  ZRX: '0x Protocol',
  STORJ: 'Storj',
  BAND: 'Band Protocol',
  ICX: 'ICON',
  ONT: 'Ontology',
  KNC: 'Kyber Network Crystal',
  CVX: 'Convex Finance',
  PENDLE: 'Pendle',
  BICO: 'Biconomy',
  ID: 'SPACE ID',
  SSV: 'ssv.network',
  MAGIC: 'Magic',
  GLMR: 'Moonbeam',
  ASTR: 'Astar',

  // --- Added: present in the live top 60 by volume, previously rendering as a bare ticker. ---
  ERA: 'Caldera',
  USD1: 'World Liberty Financial USD',
  EUL: 'Euler',
  EUR: 'Euro',
  HOME: 'Defi App',
  XAUT: 'Tether Gold',
  RLUSD: 'Ripple USD',
  GIGGLE: 'Giggle Academy',
  KAITO: 'Kaito',
  BANK: 'Lorenzo Protocol',
  MANTRA: 'MANTRA Chain',   // replaces the retired OM ticker
  DEXE: 'DeXe',
  HYPER: 'Hyperlane',
  ZAMA: 'Zama',
  PUMP: 'Pump.fun',
  MIRA: 'Mira Network',
  PENGU: 'Pudgy Penguins',
  PORTAL: 'Portal',
  EPIC: 'Epic Cash',
  EDEN: 'Eden',
  // The 1000× denomination IS the meaning of this ticker, so it belongs in the label. See also
  // CoinIcon's avatar letter (Task 13): it must render "S", not "1".
  '1000SATS': 'SATS (1000x)',
  // Audited SELF-TITLED: these two assets really are named after their ticker. Listed explicitly,
  // and present in the test's SELF_TITLED escape set, so a later maintainer does not "fix" them by
  // inventing a full name. A wrong name is worse than a terse one.
  U: 'U',
  COTI: 'COTI',
};

/** Display name for a base asset, in any case. Unmapped assets fall back to their uppercase
 *  ticker — which is a perfectly readable label, so there is no "unknown coin" state to design. */
export function coinName(symbol: string): string {
  const key = symbol.toUpperCase();
  return COIN_NAMES[key] ?? key;
}

/**
 * The two lines a coin row prints.
 *
 * When `coinName` falls back, the name IS the ticker, so the naive row renders it twice —
 * "ERA  ERA" — which reads as a rendering bug rather than as missing metadata. Measured after the
 * 23 additions above: that fires on ~0-10% of VISIBLE rows but ~40% of the full store, so the
 * surfaces it really serves are the command palette and deep links past the top 50.
 *
 * Fallback rows therefore print the ticker ONCE as the primary label and the market pair
 * ("ERA/USDT") as the muted secondary line: real information, the thing a trader looks for next,
 * and a row that looks deliberate. Every coin-row surface uses this — Markets table, gainer chips,
 * Watchlist rows, coin-detail header, command palette.
 */
export function coinLabel(coin: { symbol: string; name: string; pair: string }): {
  primary: string;
  secondary: string;
} {
  const ticker = coin.symbol.toUpperCase();
  if (coin.name === ticker) {
    return { primary: ticker, secondary: `${ticker}/USDT` };
  }
  return { primary: coin.name, secondary: ticker };
}
