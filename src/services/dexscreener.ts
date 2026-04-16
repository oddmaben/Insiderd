import { config } from '../config.js';
import { fetchWithRetry } from '../utils/fetch.js';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    symbol: string;
  };
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: {
    usd?: number | string;
    base?: number | string;
    quote?: number | string;
  };
  volume?: {
    m5: number;
    h1: number;
    h24: number;
  };
  priceChange?: {
    m5: number;
  };
  pairCreatedAt?: number;
  url: string;
  info?: {
    imageUrl?: string;
  };
}

interface SearchResponse {
  pairs?: DexScreenerPair[];
}

interface PairResponse {
  pair?: DexScreenerPair;
  pairs?: DexScreenerPair[];
}

type TokenPairsResponse = DexScreenerPair[] | { pairs?: DexScreenerPair[] };

function apiBase(): string {
  return config.api.dexscreener.replace(/\/+$/, '');
}

export async function searchDexPairs(query: string): Promise<DexScreenerPair[]> {
  const url = `${apiBase()}/latest/dex/search?q=${encodeURIComponent(query)}`;
  const data = await fetchWithRetry<SearchResponse>(url, {
    timeout: 12000,
    retries: 2
  });
  return data?.pairs || [];
}

export async function getDexPair(chainId: string, pairAddress: string): Promise<DexScreenerPair | null> {
  const url = `${apiBase()}/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`;
  const data = await fetchWithRetry<PairResponse>(url, {
    timeout: 9000,
    retries: 2,
    skipCircuitBreaker: true
  });

  if (data?.pair) {
    return data.pair;
  }
  if (data?.pairs?.length) {
    return data.pairs[0];
  }
  return null;
}

export async function getDexTokenPairs(chainId: string, tokenAddress: string): Promise<DexScreenerPair[]> {
  const url = `${apiBase()}/tokens/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
  const data = await fetchWithRetry<TokenPairsResponse>(url, {
    timeout: 9000,
    retries: 2,
    skipCircuitBreaker: true
  });

  if (Array.isArray(data)) {
    return data;
  }
  return data?.pairs || [];
}

export async function getDexTokenPairsExpanded(chainId: string, tokenAddress: string): Promise<DexScreenerPair[]> {
  const url = `${apiBase()}/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
  const data = await fetchWithRetry<TokenPairsResponse>(url, {
    timeout: 9000,
    retries: 2,
    skipCircuitBreaker: true
  });

  if (Array.isArray(data)) {
    return data;
  }
  return data?.pairs || [];
}
