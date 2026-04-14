import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { isLiquidityLocked } from './liquidityCheck.js';
import { DexScreenerPair, getDexPair, getDexTokenPairs, getDexTokenPairsExpanded, searchDexPairs } from './dexscreener.js';

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
const SEARCH_TERMS_PER_SCAN = 4;
const SEARCH_REQUEST_DELAY_MS = 350;
const MAX_CANDIDATES_PER_SCAN = 30;
const LIQUIDITY_WARMUP_MS = 2 * 60 * 1000;
const PENDING_LIQUIDITY_WINDOW_MS = 8 * 60 * 1000;
const MAX_PENDING_LIQUIDITY_CHECKS = 6;
const SEARCH_TERMS = [
  'pumpfun',
  'mayhem',
  'bonk',
  'bonkers',
  'bags',
  'memoo',
  'liquid',
  'bankr',
  'zora',
  'surge',
  'anoncoin',
  'moonshot',
  'wen.dev',
  'heaven',
  'sugar',
  'tokenmill',
  'believe',
  'trends',
  'trends.fun',
  'studio',
  'moonit',
  'boop',
  'xstocks',
  'launchlab',
  'dynamic bc',
  'raydium',
  'meteora',
  'pump amm',
  'orca'
];

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
let searchTermCursor = 0;

export async function fetchNewPairs(): Promise<TokenPair[]> {
  try {
    if (Date.now() - lastCleanup > CACHE_CLEANUP_INTERVAL) {
      cleanOldCache();
      lastCleanup = Date.now();
    }

    const allPairs: TokenPair[] = [];
    const termsForThisScan = getSearchTermsForScan();
    for (let i = 0; i < termsForThisScan.length; i++) {
      const term = termsForThisScan[i];

      try {
        const pairs = await searchDexPairs(term);
        if (pairs.length > 0) {
          allPairs.push(
            ...pairs
              .filter(p => p.chainId?.toLowerCase() === 'solana')
              .map(pair => normalizeDexPair(pair))
          );
        }
      } catch (error) {
        logger.warn(`Search term "${term}" failed:`, error);
      }

      if (i < termsForThisScan.length - 1) {
        await new Promise(resolve => setTimeout(resolve, SEARCH_REQUEST_DELAY_MS));
      }
    }

    if (allPairs.length === 0) {
      logger.warn('No pairs returned from DexScreener');
      return [];
    }

    const uniquePairs = Array.from(
      new Map(allPairs.map(p => [p.pairAddress, p])).values()
    );

    logger.info(`Fetched ${uniquePairs.length} total pairs`);

    const unseenPairs = uniquePairs
      .filter(p => !seenPairs.has(p.pairAddress))
      .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
      .slice(0, MAX_CANDIDATES_PER_SCAN);
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
      skippedLaunchpad: 0,
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

      const isAllowed = await isLiquidityLocked(p);
      if (!isAllowed) {
        scanStats.skippedLaunchpad++;
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
      `deferredLiq:${scanStats.deferredLiquidity}, launchpadSkip:${scanStats.skippedLaunchpad}, ` +
      `queuedLiq:${scanStats.queuedNoLiquidity}, prefilterPass:${scanStats.passedPrefilters}`
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
    const pairSnapshot = await getDexPair(pair.chainId, pair.pairAddress);
    const mergedPair = pairSnapshot ? mergePairs(pair, pairSnapshot) : pair;
    if (hasPositiveLiquidity(mergedPair)) {
      return mergedPair;
    }

    if (!pair.baseToken?.address) {
      return mergedPair;
    }

    const expandedPairs = await getDexTokenPairsExpanded(pair.chainId, pair.baseToken.address);
    const expandedHydrated = pickBestHydrationPair(mergedPair, expandedPairs.map(normalizeDexPair));
    if (expandedHydrated && hasPositiveLiquidity(expandedHydrated)) {
      return mergePairs(mergedPair, expandedHydrated);
    }

    const tokenPairs = await getDexTokenPairs(pair.chainId, pair.baseToken.address);
    const hydrated = pickBestHydrationPair(mergedPair, tokenPairs.map(normalizeDexPair));
    if (hydrated) {
      return mergePairs(mergedPair, hydrated);
    }

    logger.debug(
      `[LIQ-CHECK] ${pair.baseToken.symbol}: pair endpoint + token endpoints returned no positive liquidity`
    );
  } catch (error) {
    logger.debug(`Hydration failed for ${pair.baseToken.symbol}`);
  }

  return pair;
}

function pickBestHydrationPair(sourcePair: TokenPair, candidates: TokenPair[]): TokenPair | null {
  if (!candidates.length) {
    return null;
  }

  const chainId = sourcePair.chainId?.toLowerCase();
  const sourcePairAddress = sourcePair.pairAddress?.toLowerCase();
  const sourceDex = sourcePair.dexId?.toLowerCase();
  const sourceQuoteAddress = sourcePair.quoteToken?.address?.toLowerCase();

  const sameChain = candidates.filter(p => p.chainId?.toLowerCase() === chainId);
  const pool = sameChain.length ? sameChain : candidates;
  const highestLiquidityPair = pool
    .slice()
    .sort((a, b) => (readLiquidityUsd(b) - readLiquidityUsd(a)))[0] || null;

  const exactPair = pool.find(p => p.pairAddress?.toLowerCase() === sourcePairAddress);
  if (exactPair && (hasPositiveLiquidity(exactPair) || !hasPositiveLiquidity(highestLiquidityPair))) {
    return exactPair;
  }

  const sameDexAndQuote = pool.find(p =>
    p.dexId?.toLowerCase() === sourceDex &&
    p.quoteToken?.address?.toLowerCase() === sourceQuoteAddress
  );
  if (sameDexAndQuote && (hasPositiveLiquidity(sameDexAndQuote) || !hasPositiveLiquidity(highestLiquidityPair))) {
    return sameDexAndQuote;
  }

  return highestLiquidityPair;
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
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }
  logger.info('Cache cleared (memory + file)');
}

function expirePendingPair(pairAddress: string): void {
  pendingLiquidityPairs.delete(pairAddress);
  seenPairs.delete(pairAddress);
}

function getSearchTermsForScan(): string[] {
  if (SEARCH_TERMS.length <= SEARCH_TERMS_PER_SCAN) {
    return SEARCH_TERMS;
  }

  const selected: string[] = [];
  for (let i = 0; i < SEARCH_TERMS_PER_SCAN; i++) {
    const idx = (searchTermCursor + i) % SEARCH_TERMS.length;
    selected.push(SEARCH_TERMS[idx]);
  }
  searchTermCursor = (searchTermCursor + SEARCH_TERMS_PER_SCAN) % SEARCH_TERMS.length;
  return selected;
}

function normalizeDexPair(pair: DexScreenerPair): TokenPair {
  return {
    chainId: pair.chainId,
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    baseToken: pair.baseToken,
    quoteToken: pair.quoteToken,
    priceUsd: pair.priceUsd,
    fdv: toNumber(pair.fdv) || toNumber(pair.marketCap) || undefined,
    liquidity: {
      usd: toNumber(pair.liquidity?.usd)
    },
    volume: {
      m5: toNumber(pair.volume?.m5),
      h1: toNumber(pair.volume?.h1),
      h24: toNumber(pair.volume?.h24)
    },
    priceChange: {
      m5: toNumber(pair.priceChange?.m5)
    },
    pairCreatedAt: pair.pairCreatedAt,
    url: pair.url,
    info: {
      imageUrl: pair.info?.imageUrl
    }
  };
}

function mergePairs(base: TokenPair, patch: TokenPair): TokenPair {
  return {
    ...base,
    ...patch,
    baseToken: patch.baseToken || base.baseToken,
    quoteToken: patch.quoteToken || base.quoteToken,
    liquidity: {
      ...(base.liquidity || { usd: 0 }),
      ...(patch.liquidity || {})
    },
    volume: {
      ...(base.volume || { m5: 0, h1: 0, h24: 0 }),
      ...(patch.volume || {})
    },
    priceChange: {
      ...(base.priceChange || { m5: 0 }),
      ...(patch.priceChange || {})
    },
    info: {
      ...(base.info || {}),
      ...(patch.info || {})
    },
    fdv: patch.fdv || base.fdv,
    pairCreatedAt: patch.pairCreatedAt || base.pairCreatedAt
  };
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
