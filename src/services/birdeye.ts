import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

interface BirdeyeTokenOverviewResponse {
  success?: boolean;
  message?: string;
  data?: {
    liquidity?: number;
    liquidityUsd?: number;
    liquidity_usd?: number;
  };
}

const LIQUIDITY_CACHE_TTL_MS = 2 * 60 * 1000;
const MISSED_CACHE_TTL_MS = 60 * 1000;
const RATE_LIMIT_CACHE_TTL_MS = 20 * 1000;
const REQUEST_TIMEOUT_MS = 9000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const liquidityCache = new Map<string, { value: number; expiresAt: number }>();
const execFileAsync = promisify(execFile);

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

  const data = await fetchBirdeyeOverview(url, headers);
  if (!data) {
    liquidityCache.set(tokenMint, {
      value: 0,
      expiresAt: now + RATE_LIMIT_CACHE_TTL_MS
    });
    return null;
  }

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

async function fetchBirdeyeOverview(
  url: string,
  headers: Record<string, string>
): Promise<BirdeyeTokenOverviewResponse | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'MemeScanner/3.0',
          ...headers
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 400 || response.status === 404) {
          return null;
        }

        if ((response.status === 401 || response.status === 403) && attempt === 1) {
          logger.warn(`[BIRDEYE] Authorization failed (${response.status}). Check API key/plan.`);
          return null;
        }

        if (RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
          await sleep(900 * attempt);
          continue;
        }

        return null;
      }

      const data = await response.json() as BirdeyeTokenOverviewResponse;
      if (data?.success === false && attempt < 2) {
        await sleep(900 * attempt);
        continue;
      }

      return data;
    } catch {
      clearTimeout(timeoutId);
      if (attempt < 2) {
        await sleep(900 * attempt);
        continue;
      }
      return null;
    }
  }

  return fetchBirdeyeOverviewWithCurl(url, headers);
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBirdeyeOverviewWithCurl(
  url: string,
  headers: Record<string, string>
): Promise<BirdeyeTokenOverviewResponse | null> {
  try {
    const args = [
      '-sS',
      '--max-time',
      '12',
      url,
      '-H',
      `x-api-key: ${headers['x-api-key'] || headers['X-API-KEY'] || ''}`,
      '-H',
      `x-chain: ${headers['x-chain'] || 'solana'}`,
      '-H',
      `accept: ${headers['Accept'] || 'application/json'}`
    ];

    const { stdout } = await execFileAsync('curl', args, {
      timeout: 13000
    });

    const parsed = JSON.parse(stdout) as BirdeyeTokenOverviewResponse;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearBirdeyeCache(): void {
  liquidityCache.clear();
  logger.debug('Cleared Birdeye liquidity cache');
}
