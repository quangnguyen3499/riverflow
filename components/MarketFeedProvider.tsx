'use client';

import { useMarketFeed } from '@/hooks/use-market-feed';

export function MarketFeedProvider() {
  useMarketFeed();
  return null;
}

export default MarketFeedProvider;
