import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { getBirdeyeLiquidityUsd, getBirdeyeTokenList, getBirdeyeTokenSnapshot, clearBirdeyeCache, BirdeyeTokenListItem } from './birdeye.js';

export interface TokenPair {
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
  liquidity?: {
    usd: number;
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

interface CacheEntry {
  timestamp: number;
  pairCreatedAt: number;
}

interface PendingLiquidityEntry {
  pair: TokenPair;
  firstSeenAt: number;
  checks: number;
}

const CACHE_FILE = path.join(process.cwd(), 'data', 'seen_pairs.json');
const DATA_DIR = path.join(process.cwd(), 'data');
const CACHE_CLEANUP_INTERVAL = 3600000;
const BIRDEYE_LIST_LIMIT = 100;
const BIRDEYE_LIST_PAGES = 2;
const LIQUIDITY_WARMUP_MS = 2 * 60 * 1000;
const PENDING_LIQUIDITY_WINDOW_MS = 8 * 60 * 1000;
const MAX_PENDING_LIQUIDITY_CHECKS = 6;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCache(): Map<string, CacheEntry> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      const json = JSON.parse(data);
      return new Map(json);
    }
  } catch (error) {
    logger.warn('Failed to load cache, starting fresh');
  }
  return new Map();
}

function saveCache() {
  try {
    const json = JSON.stringify(Array.from(seenPairs.entries()));
    fs.writeFileSync(CACHE_FILE, json);
  } catch (error) {
    logger.error('Failed to save cache:', error);
  }
}

const seenPairs = loadCache();
const pendingLiquidityPairs = new Map<string, PendingLiquidityEntry>();
let lastCleanup = Date.now();

export async function fetchNewPairs(): Promise<TokenPair[]> {
  try {
    if (Date.now() - lastCleanup > CACHE_CLEANUP_INTERVAL) {
      cleanOldCache();
      lastCleanup = Date.now();
    }

    const allPairs: TokenPair[] = [];
    for (let page = 0; page < BIRDEYE_LIST_PAGES; page++) {
      const items = await getBirdeyeTokenList(BIRDEYE_LIST_LIMIT, page * BIRDEYE_LIST_LIMIT);
      if (!items.length) {
        continue;
      }
      allPairs.push(...items.map(mapBirdeyeItemToPair));
    }

    if (allPairs.length === 0) {
      logger.warn('No tokens returned from BirdEye token list');
      return [];
    }

    const uniquePairs = Array.from(
      new Map(allPairs.map(p => [p.pairAddress, p])).values()
    );

    logger.info(`Fetched ${uniquePairs.length} total pairs`);

    const unseenPairs = uniquePairs.filter(p => !seenPairs.has(p.pairAddress));
    const pendingRechecks = getPendingRecheckPairs();
    const candidates = Array.from(
      new Map([...unseenPairs, ...pendingRechecks].map(p => [p.pairAddress, p])).values()
    );

    const now = Date.now();
    const maxAge = config.scanner.maxAgeMinutes * 60 * 1000;
    const scanStats = {
      candidates: candidates.length,
      skippedAge: 0,
      deferredLiquidity: 0,
      queuedNoLiquidity: 0,
      passedPrefilters: 0
    };
    
    const newPairs: TokenPair[] = [];
    for (const rawPair of candidates) {
      const p = await hydratePair(rawPair);

      const createdAt = p.pairCreatedAt || now;
      const age = now - createdAt;
      if (age > maxAge) {
        pendingLiquidityPairs.delete(p.pairAddress);
        scanStats.skippedAge++;
        continue;
      }

      if (shouldDeferForLiquidityWarmup(p, age)) {
        queuePendingLiquidityPair(p, now);
        logger.debug(`⏳ ${p.baseToken.symbol}: Deferring until liquidity settles`);
        scanStats.deferredLiquidity++;
        continue;
      }

      if (!hasPositiveLiquidity(p)) {
        if (age < LIQUIDITY_WARMUP_MS) {
          queuePendingLiquidityPair(p, now);
          scanStats.queuedNoLiquidity++;
          continue;
        }
        logger.debug(`⚠️ ${p.baseToken.symbol}: Liquidity still zero after warmup, processing anyway`);
      }

      pendingLiquidityPairs.delete(p.pairAddress);
      scanStats.passedPrefilters++;
      newPairs.push(p);
    }

    logger.info(
      `Scan filter stats → candidates:${scanStats.candidates}, ageSkip:${scanStats.skippedAge}, ` +
      `deferredLiq:${scanStats.deferredLiquidity}, queuedLiq:${scanStats.queuedNoLiquidity}, ` +
      `prefilterPass:${scanStats.passedPrefilters}`
    );

    newPairs.forEach(p => {
      seenPairs.set(p.pairAddress, {
        timestamp: Date.now(),
        pairCreatedAt: p.pairCreatedAt || 0
      });
    });

    if (newPairs.length > 0) {
      saveCache();
      logger.success(`🆕 Found ${newPairs.length} NEW pairs!`);
      newPairs.forEach(p => {
        const age = getAgeMinutes(p.pairCreatedAt || 0);
        logger.info(`  → ${p.baseToken.symbol} (${formatAge(age)})`);
      });
    }

    return newPairs;

  } catch (error) {
    logger.error('Critical error in fetchNewPairs:', error);
    return [];
  }
}

export async function refreshPairData(pair: TokenPair): Promise<TokenPair> {
  return hydratePair(pair);
}

async function hydratePair(pair: TokenPair): Promise<TokenPair> {
  const needsHydration = !pair.liquidity?.usd || !pair.volume?.m5 || !pair.fdv || !pair.priceUsd;
  if (!needsHydration) {
    return pair;
  }

  try {
    const snapshot = await getBirdeyeTokenSnapshot(pair.baseToken.address);
    if (snapshot) {
      return {
        ...pair,
        priceUsd: snapshot.priceUsd > 0 ? String(snapshot.priceUsd) : pair.priceUsd,
        fdv: snapshot.fdv > 0 ? snapshot.fdv : (snapshot.marketCap > 0 ? snapshot.marketCap : pair.fdv),
        liquidity: {
          ...(pair.liquidity || { usd: 0 }),
          usd: snapshot.liquidityUsd > 0 ? snapshot.liquidityUsd : (pair.liquidity?.usd || 0)
        },
        volume: {
          ...(pair.volume || { m5: 0, h1: 0, h24: 0 }),
          m5: snapshot.volume5mUsd > 0 ? snapshot.volume5mUsd : (pair.volume?.m5 || 0)
        },
        info: {
          ...(pair.info || {}),
          imageUrl: snapshot.logoUrl || pair.info?.imageUrl
        }
      };
    }
  } catch (error) {
    logger.debug(`Hydration failed for ${pair.baseToken.symbol}`);
  }

  return hydrateLiquidityFromBirdeye(pair);
}

function hasPositiveLiquidity(pair: TokenPair | null): boolean {
  return readLiquidityUsd(pair) > 0;
}

function readLiquidityUsd(pair: TokenPair | null): number {
  const raw = pair?.liquidity?.usd;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function shouldDeferForLiquidityWarmup(pair: TokenPair, ageMs: number): boolean {
  if (ageMs > LIQUIDITY_WARMUP_MS) {
    return false;
  }

  const liquidityUsd = readLiquidityUsd(pair);
  if (liquidityUsd > 0) {
    return false;
  }

  const volume5m = pair.volume?.m5 || 0;
  const marketCap = pair.fdv || 0;
  return volume5m > 0 || marketCap > 0;
}

function queuePendingLiquidityPair(pair: TokenPair, now: number): void {
  const existing = pendingLiquidityPairs.get(pair.pairAddress);
  if (!existing) {
    pendingLiquidityPairs.set(pair.pairAddress, {
      pair,
      firstSeenAt: now,
      checks: 1
    });
    seenPairs.set(pair.pairAddress, {
      timestamp: now,
      pairCreatedAt: pair.pairCreatedAt || 0
    });
    return;
  }

  existing.pair = pair;
  existing.checks += 1;

  const expiredByChecks = existing.checks >= MAX_PENDING_LIQUIDITY_CHECKS;
  const expiredByTime = now - existing.firstSeenAt > PENDING_LIQUIDITY_WINDOW_MS;
  if (expiredByChecks || expiredByTime) {
    expirePendingPair(pair.pairAddress);
  }
}

function getPendingRecheckPairs(): TokenPair[] {
  if (pendingLiquidityPairs.size === 0) {
    return [];
  }

  const now = Date.now();
  const rechecks: TokenPair[] = [];

  for (const [address, entry] of pendingLiquidityPairs.entries()) {
    const expiredByChecks = entry.checks >= MAX_PENDING_LIQUIDITY_CHECKS;
    const expiredByTime = now - entry.firstSeenAt > PENDING_LIQUIDITY_WINDOW_MS;
    if (expiredByChecks || expiredByTime) {
      expirePendingPair(address);
      continue;
    }
    rechecks.push(entry.pair);
  }

  return rechecks;
}

function cleanOldCache(): void {
  const now = Date.now();
  const maxCacheAge = 24 * 60 * 60 * 1000;
  
  const entriesToDelete: string[] = [];
  
  for (const [address, entry] of seenPairs.entries()) {
    if (now - entry.timestamp > maxCacheAge) {
      entriesToDelete.push(address);
    }
  }
  
  entriesToDelete.forEach(address => seenPairs.delete(address));
  
  if (entriesToDelete.length > 0) {
    saveCache();
    logger.info(`[MEMORY] Cleaned ${entriesToDelete.length} old cache entries`);
  }
}

export function getAgeMinutes(createdAt: number): number {
  return (Date.now() - createdAt) / 60000;
}

export function formatAge(minutes: number): string {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h${m}m`;
}

export function getCacheStats(): { size: number; oldest: number } {
  const now = Date.now();
  let oldest = 0;
  
  for (const entry of seenPairs.values()) {
    const age = now - entry.timestamp;
    if (age > oldest) oldest = age;
  }
  
  return {
    size: seenPairs.size,
    oldest: Math.floor(oldest / 60000)
  };
}

export function clearCache(): void {
  seenPairs.clear();
  pendingLiquidityPairs.clear();
  clearBirdeyeCache();
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }
  logger.info('Cache cleared (memory + file)');
}

function expirePendingPair(pairAddress: string): void {
  pendingLiquidityPairs.delete(pairAddress);
  seenPairs.delete(pairAddress);
}

async function hydrateLiquidityFromBirdeye(pair: TokenPair): Promise<TokenPair> {
  if (hasPositiveLiquidity(pair)) {
    return pair;
  }

  const volume5m = pair.volume?.m5 || 0;
  const fdv = pair.fdv || 0;
  const likelyNoiseToken = volume5m < 300 && fdv < config.scanner.minMarketCap;
  if (likelyNoiseToken) {
    return pair;
  }

  const tokenMint = pair.baseToken?.address;
  if (!tokenMint) {
    return pair;
  }

  const birdeyeLiquidity = await getBirdeyeLiquidityUsd(tokenMint);
  if (!birdeyeLiquidity || birdeyeLiquidity <= 0) {
    return pair;
  }

  logger.debug(`Birdeye liquidity hydration succeeded for ${pair.baseToken.symbol}: $${birdeyeLiquidity.toFixed(0)}`);
  return {
    ...pair,
    liquidity: {
      ...(pair.liquidity || { usd: 0 }),
      usd: birdeyeLiquidity
    }
  };
}

function mapBirdeyeItemToPair(item: BirdeyeTokenListItem): TokenPair {
  const createdAtMs = resolveCreationTimeMs(item);
  const liquidityUsd = toNumber(item.liquidity);
  const volume5m = toNumber(item.volume_5m_usd);
  const marketCap = toNumber(item.fdv) || toNumber(item.market_cap);
  const price = toNumber(item.price);
  const priceChange5m = toNumber(item.price_change_5m_percent);

  return {
    chainId: 'solana',
    dexId: 'birdeye',
    pairAddress: item.address,
    baseToken: {
      address: item.address,
      name: item.name || item.symbol || 'Unknown',
      symbol: item.symbol || 'UNKNOWN'
    },
    quoteToken: {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL'
    },
    priceUsd: price > 0 ? String(price) : undefined,
    fdv: marketCap > 0 ? marketCap : undefined,
    liquidity: {
      usd: liquidityUsd
    },
    volume: {
      m5: volume5m,
      h1: 0,
      h24: 0
    },
    priceChange: {
      m5: priceChange5m
    },
    pairCreatedAt: createdAtMs,
    url: `https://birdeye.so/token/${item.address}?chain=solana`,
    info: {
      imageUrl: item.logo_uri
    }
  };
}

function resolveCreationTimeMs(item: BirdeyeTokenListItem): number {
  const recentListingMs = toNumber(item.recent_listing_time) * 1000;
  if (recentListingMs > 0) {
    return recentListingMs;
  }
  const lastTradeMs = toNumber(item.last_trade_unix_time) * 1000;
  if (lastTradeMs > 0) {
    return lastTradeMs;
  }
  return Date.now();
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
