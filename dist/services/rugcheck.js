import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { sleep } from '../utils/fetch.js';
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens';
const RUGCHECK_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([400, 429, 500, 502, 503, 504]);
const RUGCHECK_CACHE_TTL_MS = 2 * 60 * 1000;
const rugcheckCache = new Map();
const BLOCKED_RISK_PATTERNS = [
    'incomplete security data',
    'anti-whale',
    'blacklist',
    'balances modifiable',
    'honeypot detected',
    'honeypot trigger',
    'modifiable taxes',
    'hidden owner',
    'proxy contract',
    'suspicious function',
    'tax farmer',
    'unverified contract',
    'mutable contract',
    'transfer freeze',
    'freezable',
    'mintable',
    'rug pull',
    'red flag'
];
export async function checkRugStatus(pair) {
    const mint = pair.baseToken.address;
    const now = Date.now();
    const cached = rugcheckCache.get(mint);
    if (cached && cached.expiresAt > now) {
        return cached.safe;
    }
    if (cached) {
        rugcheckCache.delete(mint);
    }
    try {
        const url = `${RUGCHECK_API}/${mint}/report/summary`;
        for (let attempt = 1; attempt <= RUGCHECK_MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                if (!response.ok) {
                    if (response.status === 404) {
                        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Incomplete security data (RugCheck missing)`);
                        return cacheRugcheckResult(mint, false, 10 * 60 * 1000);
                    }
                    const shouldRetry = RETRYABLE_STATUS_CODES.has(response.status) && attempt < RUGCHECK_MAX_ATTEMPTS;
                    if (shouldRetry) {
                        const delay = 500 * attempt;
                        logger.debug(`RugCheck retry ${attempt}/${RUGCHECK_MAX_ATTEMPTS - 1} for ${pair.baseToken.symbol} (${response.status})`);
                        await sleep(delay);
                        continue;
                    }
                    if (response.status === 400) {
                        logger.warn(`⚠️ ${pair.baseToken.symbol}: RugCheck returned 400 after retries, allowing with caution`);
                        return cacheRugcheckResult(mint, true, 2 * 60 * 1000);
                    }
                    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck unavailable (${response.status})`);
                    return cacheRugcheckResult(mint, false, 60 * 1000);
                }
                const data = await response.json();
                const score = data.score || 0;
                if (score > config.security.maxRugcheckScore) {
                    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: High RugCheck Score (${score} > ${config.security.maxRugcheckScore})`);
                    return cacheRugcheckResult(mint, false, 10 * 60 * 1000);
                }
                const risks = data.risks || [];
                const criticalRisks = risks.filter((r) => r.level === 'danger');
                const blockedRisks = risks.filter((risk) => {
                    const normalizedName = (risk.name || '').toLowerCase();
                    return BLOCKED_RISK_PATTERNS.some(pattern => normalizedName.includes(pattern));
                });
                if (criticalRisks.length > 0) {
                    const riskNames = criticalRisks.map((r) => r.name).join(', ');
                    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Critical Risks (${riskNames})`);
                    return cacheRugcheckResult(mint, false, 10 * 60 * 1000);
                }
                if (blockedRisks.length > 0) {
                    const riskNames = blockedRisks.map((r) => r.name).join(', ');
                    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Blocklisted Risks (${riskNames})`);
                    return cacheRugcheckResult(mint, false, 10 * 60 * 1000);
                }
                logger.debug(`✅ ${pair.baseToken.symbol}: RugCheck Passed (Score: ${score})`);
                return cacheRugcheckResult(mint, true, RUGCHECK_CACHE_TTL_MS);
            }
            catch (error) {
                if (attempt < RUGCHECK_MAX_ATTEMPTS) {
                    const delay = 500 * attempt;
                    logger.debug(`RugCheck network retry ${attempt}/${RUGCHECK_MAX_ATTEMPTS - 1} for ${pair.baseToken.symbol}`);
                    await sleep(delay);
                    continue;
                }
                logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck API failed`);
                return cacheRugcheckResult(mint, false, 60 * 1000);
            }
        }
        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck exhausted retries`);
        return cacheRugcheckResult(mint, false, 60 * 1000);
    }
    catch {
        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck setup failed`);
        return cacheRugcheckResult(mint, false, 60 * 1000);
    }
}
function cacheRugcheckResult(mint, safe, ttlMs) {
    rugcheckCache.set(mint, {
        safe,
        expiresAt: Date.now() + ttlMs
    });
    return safe;
}
//# sourceMappingURL=rugcheck.js.map