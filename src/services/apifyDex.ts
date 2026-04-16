import { config } from '../config.js';
import { DexScreenerPair } from './dexscreener.js';
import { logger } from '../utils/logger.js';

interface ApifyPairToken {
  address?: string;
  symbol?: string;
  name?: string;
}

interface ApifyPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string | number;
  fdv?: number;
  marketCap?: number;
  liquidity?: {
    usd?: number | string;
    base?: number | string;
    quote?: number | string;
  };
  volume?: {
    m5?: number | string;
    h1?: number | string;
    h24?: number | string;
  };
  priceChange?: {
    m5?: number | string;
  };
  pairCreatedAt?: number | string;
  url?: string;
  info?: {
    imageUrl?: string;
  };
  baseToken?: ApifyPairToken;
  quoteToken?: ApifyPairToken;
}

type ApifyDatasetItem = ApifyPair | { pair?: ApifyPair } | Record<string, unknown>;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringSafe(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeRawPair(item: ApifyDatasetItem): ApifyPair | null {
  if (!item || typeof item !== 'object') return null;
  if ('pair' in item && item.pair && typeof item.pair === 'object') {
    return item.pair as ApifyPair;
  }
  return item as ApifyPair;
}

function mapApifyPair(pair: ApifyPair): DexScreenerPair | null {
  const baseAddress = toStringSafe(pair.baseToken?.address);
  const pairAddress = toStringSafe(pair.pairAddress || baseAddress);
  const chainId = toStringSafe(pair.chainId, config.api.apifyChain);

  if (!pairAddress || !baseAddress) {
    return null;
  }

  return {
    chainId,
    dexId: toStringSafe(pair.dexId, 'unknown'),
    pairAddress,
    baseToken: {
      address: baseAddress,
      name: toStringSafe(pair.baseToken?.name, toStringSafe(pair.baseToken?.symbol, 'Unknown')),
      symbol: toStringSafe(pair.baseToken?.symbol, 'UNKNOWN')
    },
    quoteToken: {
      address: toStringSafe(pair.quoteToken?.address, ''),
      symbol: toStringSafe(pair.quoteToken?.symbol, 'SOL')
    },
    priceUsd: pair.priceUsd !== undefined ? String(pair.priceUsd) : undefined,
    fdv: toNumber(pair.fdv),
    marketCap: toNumber(pair.marketCap),
    liquidity: {
      usd: pair.liquidity?.usd,
      base: pair.liquidity?.base,
      quote: pair.liquidity?.quote
    },
    volume: {
      m5: toNumber(pair.volume?.m5),
      h1: toNumber(pair.volume?.h1),
      h24: toNumber(pair.volume?.h24)
    },
    priceChange: {
      m5: toNumber(pair.priceChange?.m5)
    },
    pairCreatedAt: toNumber(pair.pairCreatedAt) || undefined,
    url: toStringSafe(pair.url, `https://dexscreener.com/${chainId}/${pairAddress}`),
    info: {
      imageUrl: pair.info?.imageUrl
    }
  };
}

export async function fetchApifyDexPairs(): Promise<DexScreenerPair[]> {
  if (!config.api.apifyApiToken || !config.api.apifyActorId) {
    logger.warn('[APIFY] Missing APIFY_API_TOKEN or APIFY_ACTOR_ID');
    return [];
  }

  const requiresTokenAddresses = config.api.apifyActorId.includes('muhammetakkurtt/dexscreener-pair-data-scraper');
  if (requiresTokenAddresses && config.api.apifyTokenAddresses.length === 0) {
    logger.warn('[APIFY] This actor requires APIFY_TOKEN_ADDRESSES; none configured.');
    return [];
  }

  const actorId = encodeURIComponent(config.api.apifyActorId);
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(config.api.apifyApiToken)}&format=json&clean=true`;

  const inputPayload = {
    chain: config.api.apifyChain,
    maxItems: config.api.apifyMaxItems,
    tokenAddresses: config.api.apifyTokenAddresses
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(inputPayload)
    });

    if (!response.ok) {
      logger.warn(`[APIFY] Actor request failed: HTTP ${response.status}`);
      return [];
    }

    const items = await response.json() as ApifyDatasetItem[];
    if (!Array.isArray(items)) {
      logger.warn('[APIFY] Unexpected dataset shape (not array)');
      return [];
    }

    const pairs = items
      .map(normalizeRawPair)
      .filter((p): p is ApifyPair => Boolean(p))
      .map(mapApifyPair)
      .filter((p): p is DexScreenerPair => Boolean(p))
      .filter(p => (p.chainId || '').toLowerCase() === config.api.apifyChain.toLowerCase());

    logger.info(`[APIFY] Retrieved ${pairs.length} pair candidate(s)`);
    return pairs;
  } catch (error: any) {
    logger.warn(`[APIFY] Fetch failed: ${error?.message || error}`);
    return [];
  }
}
