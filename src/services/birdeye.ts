import { config } from '../config.js';
import { fetchWithRetry } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';

interface BirdeyeTokenOverviewResponse {
  success?: boolean;
  data?: {
    liquidity?: number;
    liquidityUsd?: number;
    liquidity_usd?: number;
  };
}

const LIQUIDITY_CACHE_TTL_MS = 2 * 60 * 1000;
const MISSED_CACHE_TTL_MS = 60 * 1000;
const liquidityCache = new Map<string, { value: number; expiresAt: number }>();

export async function getBirdeyeLiquidityUsd(tokenMint: string): Promise<number | null> {
  const now = Date.now();
  const cached = liquidityCache.get(tokenMint);
  if (cached && cached.expiresAt > now) {
    return cached.value > 0 ? cached.value : null;
  }
  if (cached) {
    liquidityCache.delete(tokenMint);
  }

  const birdeyeBase = config.api.birdeye.replace(/\/+$/, '');
  const url = `${birdeyeBase}/defi/token_overview?address=${encodeURIComponent(tokenMint)}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'x-chain': 'solana'
  };

  if (config.api.birdeyeApiKey) {
    headers['X-API-KEY'] = config.api.birdeyeApiKey;
    headers['x-api-key'] = config.api.birdeyeApiKey;
  }

  const data = await fetchWithRetry<BirdeyeTokenOverviewResponse>(url, {
    timeout: 9000,
    retries: 2,
    retryDelay: 1200,
    skipCircuitBreaker: true,
    headers
  });

  const liquidity = extractLiquidityUsd(data);
  if (liquidity > 0) {
    liquidityCache.set(tokenMint, {
      value: liquidity,
      expiresAt: now + LIQUIDITY_CACHE_TTL_MS
    });
    return liquidity;
  }

  liquidityCache.set(tokenMint, {
    value: 0,
    expiresAt: now + MISSED_CACHE_TTL_MS
  });
  return null;
}

function extractLiquidityUsd(payload: BirdeyeTokenOverviewResponse | null): number {
  if (!payload?.data) return 0;

  const candidateValues = [
    payload.data.liquidityUsd,
    payload.data.liquidity_usd,
    payload.data.liquidity
  ];

  for (const value of candidateValues) {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }

  return 0;
}

export function clearBirdeyeCache(): void {
  liquidityCache.clear();
  logger.debug('Cleared Birdeye liquidity cache');
}
