import { config } from '../config.js';
import { fetchWithRetry } from '../utils/fetch.js';
function apiBase() {
    return config.api.dexscreener.replace(/\/+$/, '');
}
export async function searchDexPairs(query) {
    const url = `${apiBase()}/latest/dex/search?q=${encodeURIComponent(query)}`;
    const data = await fetchWithRetry(url, {
        timeout: 12000,
        retries: 2
    });
    return data?.pairs || [];
}
export async function getDexPair(chainId, pairAddress) {
    const url = `${apiBase()}/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`;
    const data = await fetchWithRetry(url, {
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
export async function getDexTokenPairs(chainId, tokenAddress) {
    const url = `${apiBase()}/tokens/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
    const data = await fetchWithRetry(url, {
        timeout: 9000,
        retries: 2,
        skipCircuitBreaker: true
    });
    if (Array.isArray(data)) {
        return data;
    }
    return data?.pairs || [];
}
export async function getDexTokenPairsExpanded(chainId, tokenAddress) {
    const url = `${apiBase()}/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
    const data = await fetchWithRetry(url, {
        timeout: 9000,
        retries: 2,
        skipCircuitBreaker: true
    });
    if (Array.isArray(data)) {
        return data;
    }
    return data?.pairs || [];
}
//# sourceMappingURL=dexscreener.js.map