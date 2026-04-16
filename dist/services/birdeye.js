import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
const LIQUIDITY_CACHE_TTL_MS = 2 * 60 * 1000;
const MISSED_CACHE_TTL_MS = 60 * 1000;
const RATE_LIMIT_CACHE_TTL_MS = 20 * 1000;
const REQUEST_TIMEOUT_MS = 9000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const liquidityCache = new Map();
const execFileAsync = promisify(execFile);
let authWarningShown = false;
export async function getBirdeyeLiquidityUsd(tokenMint) {
    const now = Date.now();
    const cached = liquidityCache.get(tokenMint);
    if (cached && cached.expiresAt > now) {
        return cached.value > 0 ? cached.value : null;
    }
    if (cached) {
        liquidityCache.delete(tokenMint);
    }
    const snapshot = await getBirdeyeTokenSnapshot(tokenMint);
    if (!snapshot) {
        liquidityCache.set(tokenMint, {
            value: 0,
            expiresAt: now + RATE_LIMIT_CACHE_TTL_MS
        });
        return null;
    }
    const liquidity = snapshot.liquidityUsd;
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
export async function getBirdeyeTokenSnapshot(tokenMint) {
    if (!tokenMint) {
        return null;
    }
    const payload = await fetchBirdeyePayload(`/defi/token_overview?address=${encodeURIComponent(tokenMint)}`);
    if (!payload?.data) {
        return null;
    }
    const data = payload.data;
    return {
        liquidityUsd: firstPositiveNumber(data, ['liquidityUsd', 'liquidity_usd', 'liquidity']),
        marketCap: firstPositiveNumber(data, ['marketCap', 'market_cap', 'mc']),
        fdv: firstPositiveNumber(data, ['fdv']),
        volume5mUsd: firstPositiveNumber(data, ['volume5mUSD', 'volume_5m_usd', 'v5mUSD']),
        priceUsd: firstPositiveNumber(data, ['price', 'priceUsd', 'price_usd']),
        logoUrl: firstString(data, ['logoURI', 'logo_uri', 'image']),
        name: firstString(data, ['name']),
        symbol: firstString(data, ['symbol']),
        lastTradeUnixTime: firstNumber(data, ['lastTradeUnixTime', 'last_trade_unix_time']),
        recentListingUnixTime: firstNumber(data, ['recentListingTime', 'recent_listing_time'])
    };
}
export async function getBirdeyeTokenList(limit = 50, offset = 0) {
    const payload = await fetchBirdeyePayload(`/defi/v3/token/list?sort_by=recent_listing_time&sort_type=desc&limit=${limit}&offset=${offset}&min_liquidity=1`);
    const rawItems = (payload?.data?.items || payload?.data?.tokens);
    if (!Array.isArray(rawItems)) {
        return [];
    }
    return rawItems
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const obj = item;
        const address = firstString(obj, ['address']);
        if (!address)
            return null;
        return {
            address,
            logo_uri: firstString(obj, ['logo_uri', 'logoURI']),
            name: firstString(obj, ['name']),
            symbol: firstString(obj, ['symbol']),
            liquidity: firstNumber(obj, ['liquidity']),
            market_cap: firstNumber(obj, ['market_cap', 'mc']),
            fdv: firstNumber(obj, ['fdv']),
            volume_5m_usd: firstNumber(obj, ['volume_5m_usd', 'volume5mUSD']),
            price: firstNumber(obj, ['price']),
            price_change_5m_percent: firstNumber(obj, ['price_change_5m_percent']),
            last_trade_unix_time: firstNumber(obj, ['last_trade_unix_time', 'lastTradeUnixTime']),
            recent_listing_time: firstNumber(obj, ['recent_listing_time', 'recentListingTime'])
        };
    })
        .filter((item) => Boolean(item));
}
async function fetchBirdeyePayload(path) {
    const birdeyeBase = config.api.birdeye.replace(/\/+$/, '');
    const url = `${birdeyeBase}${path}`;
    const headers = getBirdeyeHeaders();
    return fetchBirdeyeApi(url, headers);
}
function getBirdeyeHeaders() {
    const headers = {
        'Accept': 'application/json',
        'x-chain': 'solana'
    };
    if (config.api.birdeyeApiKey) {
        headers['X-API-KEY'] = config.api.birdeyeApiKey;
        headers['x-api-key'] = config.api.birdeyeApiKey;
    }
    return headers;
}
async function fetchBirdeyeApi(url, headers) {
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
                    if (!authWarningShown) {
                        logger.warn(`[BIRDEYE] Authorization failed (${response.status}) in fetch; trying curl fallback.`);
                        authWarningShown = true;
                    }
                    return fetchBirdeyeOverviewWithCurl(url, headers);
                }
                if (RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
                    await sleep(900 * attempt);
                    continue;
                }
                return null;
            }
            const data = await response.json();
            if (data?.success === false && attempt < 2) {
                await sleep(900 * attempt);
                continue;
            }
            return data;
        }
        catch {
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function fetchBirdeyeOverviewWithCurl(url, headers) {
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
        const parsed = JSON.parse(stdout);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
export function clearBirdeyeCache() {
    liquidityCache.clear();
    logger.debug('Cleared Birdeye liquidity cache');
}
function firstPositiveNumber(source, keys) {
    for (const key of keys) {
        const n = firstNumber(source, [key]);
        if (n > 0) {
            return n;
        }
    }
    return 0;
}
function firstNumber(source, keys) {
    for (const key of keys) {
        const value = source[key];
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    return 0;
}
function firstString(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
    }
    return undefined;
}
//# sourceMappingURL=birdeye.js.map