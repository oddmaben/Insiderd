import fs from 'fs';
import path from 'path';
import { fetchWithRetry } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { isLiquidityLocked } from './liquidityCheck.js';
import { checkRugStatus } from './rugcheck.js';
const CACHE_FILE = path.join(process.cwd(), 'data', 'seen_pairs.json');
const DATA_DIR = path.join(process.cwd(), 'data');
const CACHE_CLEANUP_INTERVAL = 3600000;
const SEARCH_TERMS_PER_SCAN = 8;
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
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf-8');
            const json = JSON.parse(data);
            return new Map(json);
        }
    }
    catch (error) {
        logger.warn('Failed to load cache, starting fresh');
    }
    return new Map();
}
function saveCache() {
    try {
        const json = JSON.stringify(Array.from(seenPairs.entries()));
        fs.writeFileSync(CACHE_FILE, json);
    }
    catch (error) {
        logger.error('Failed to save cache:', error);
    }
}
const seenPairs = loadCache();
let lastCleanup = Date.now();
let searchTermCursor = 0;
export async function fetchNewPairs() {
    try {
        if (Date.now() - lastCleanup > CACHE_CLEANUP_INTERVAL) {
            cleanOldCache();
            lastCleanup = Date.now();
        }
        const allPairs = [];
        const termsForThisScan = getSearchTermsForScan();
        const searchPromises = termsForThisScan.map(async (term) => {
            try {
                const url = `${config.api.dexscreener}/search?q=${encodeURIComponent(term)}`;
                const data = await fetchWithRetry(url, {
                    timeout: 8000,
                    retries: 2
                });
                if (data?.pairs) {
                    return data.pairs.filter(p => p.chainId?.toLowerCase() === 'solana');
                }
            }
            catch (error) {
                logger.warn(`Search term "${term}" failed:`, error);
            }
            return [];
        });
        const searchResults = await Promise.all(searchPromises);
        searchResults.forEach(pairs => allPairs.push(...pairs));
        if (allPairs.length === 0) {
            logger.warn('No pairs returned from DexScreener');
            return [];
        }
        const uniquePairs = Array.from(new Map(allPairs.map(p => [p.pairAddress, p])).values());
        logger.info(`Fetched ${uniquePairs.length} total pairs`);
        const unseenPairs = uniquePairs.filter(p => !seenPairs.has(p.pairAddress));
        const now = Date.now();
        const maxAge = config.scanner.maxAgeMinutes * 60 * 1000;
        const newPairs = [];
        for (const rawPair of unseenPairs) {
            const p = await hydratePair(rawPair);
            if (!p.pairCreatedAt)
                continue;
            const age = now - p.pairCreatedAt;
            if (age > maxAge)
                continue;
            const isLocked = await isLiquidityLocked(p);
            if (!isLocked)
                continue;
            const isSafe = await checkRugStatus(p);
            if (!isSafe)
                continue;
            newPairs.push(p);
        }
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
    }
    catch (error) {
        logger.error('Critical error in fetchNewPairs:', error);
        return [];
    }
}
export async function refreshPairData(pair) {
    return hydratePair(pair);
}
async function hydratePair(pair) {
    const needsHydration = !pair.liquidity?.usd || !pair.volume?.m5 || !pair.fdv;
    if (!needsHydration) {
        return pair;
    }
    try {
        const url = `${config.api.dexscreener}/pairs/${encodeURIComponent(pair.chainId)}/${encodeURIComponent(pair.pairAddress)}`;
        const data = await fetchWithRetry(url, {
            timeout: 8000,
            retries: 2,
            skipCircuitBreaker: true
        });
        const hydrated = data?.pairs?.[0] || data?.pair;
        if (hydrated) {
            return {
                ...pair,
                ...hydrated
            };
        }
    }
    catch (error) {
        logger.debug(`Hydration failed for ${pair.baseToken.symbol}`);
    }
    return pair;
}
function getSearchTermsForScan() {
    if (SEARCH_TERMS.length <= SEARCH_TERMS_PER_SCAN) {
        return SEARCH_TERMS;
    }
    const selected = [];
    for (let i = 0; i < SEARCH_TERMS_PER_SCAN; i++) {
        const idx = (searchTermCursor + i) % SEARCH_TERMS.length;
        selected.push(SEARCH_TERMS[idx]);
    }
    searchTermCursor = (searchTermCursor + SEARCH_TERMS_PER_SCAN) % SEARCH_TERMS.length;
    return selected;
}
function cleanOldCache() {
    const now = Date.now();
    const maxCacheAge = 24 * 60 * 60 * 1000;
    const entriesToDelete = [];
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
export function getAgeMinutes(createdAt) {
    return (Date.now() - createdAt) / 60000;
}
export function formatAge(minutes) {
    if (minutes < 1)
        return '<1m';
    if (minutes < 60)
        return `${Math.floor(minutes)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h}h${m}m`;
}
export function getCacheStats() {
    const now = Date.now();
    let oldest = 0;
    for (const entry of seenPairs.values()) {
        const age = now - entry.timestamp;
        if (age > oldest)
            oldest = age;
    }
    return {
        size: seenPairs.size,
        oldest: Math.floor(oldest / 60000)
    };
}
export function clearCache() {
    seenPairs.clear();
    if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE);
    }
    logger.info('Cache cleared (memory + file)');
}
//# sourceMappingURL=scanner.js.map