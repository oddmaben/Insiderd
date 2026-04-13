import { fetchWithRetry, sleep } from '../utils/fetch.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sendRawMessage } from './telegram.js';
const TARGET_MULTIPLIERS = [1.5, 2, 2.5, 3, 5, 7, 9, 10, 12, 15, 20];
const activeTrackers = new Map();
function parseMarketCap(pair) {
    if (pair.fdv && pair.fdv > 0) {
        return pair.fdv;
    }
    const liquidity = pair.liquidity?.usd ?? 0;
    return liquidity * 10;
}
export function startMultiplierTracking(pair) {
    const address = pair.baseToken.address;
    if (activeTrackers.has(address)) {
        return;
    }
    const baseMc = parseMarketCap(pair);
    if (!baseMc || baseMc <= 0) {
        logger.warn(`[MULTIPLIER] Cannot start tracking ${pair.baseToken.symbol}, invalid base MC`);
        return;
    }
    const state = {
        baseMc,
        remainingTargets: [...TARGET_MULTIPLIERS],
        startedAt: Date.now()
    };
    activeTrackers.set(address, state);
    logger.info(`[MULTIPLIER] Started tracking ${pair.baseToken.symbol} from MC ${baseMc}`);
    void trackLoop(pair, state);
}
async function trackLoop(pair, state) {
    const address = pair.baseToken.address;
    const symbol = pair.baseToken.symbol;
    const MAX_TRACK_MINUTES = 6 * 60;
    const CHECK_INTERVAL_MS = 60_000;
    while (true) {
        if (!activeTrackers.has(address)) {
            return;
        }
        const ageMinutes = (Date.now() - state.startedAt) / 60000;
        if (ageMinutes > MAX_TRACK_MINUTES) {
            logger.info(`[MULTIPLIER] Stopping tracking for ${symbol}, max window reached`);
            activeTrackers.delete(address);
            return;
        }
        try {
            const url = `${config.api.dexscreener}/pairs/${encodeURIComponent(pair.chainId)}/${encodeURIComponent(pair.pairAddress)}`;
            const data = await fetchWithRetry(url, {
                timeout: 8000,
                retries: 2
            });
            const currentMc = data?.pair?.fdv ?? state.baseMc;
            if (!currentMc || currentMc <= 0) {
                logger.warn(`[MULTIPLIER] No valid MC for ${symbol} on this check`);
            }
            else {
                const multiple = currentMc / state.baseMc;
                const newlyHit = [];
                state.remainingTargets = state.remainingTargets.filter(target => {
                    if (multiple >= target) {
                        newlyHit.push(target);
                        return false;
                    }
                    return true;
                });
                if (newlyHit.length > 0) {
                    const highest = Math.max(...newlyHit);
                    const msg = formatMultiplierMessage(symbol, state.baseMc, currentMc, highest);
                    await sendRawMessage(msg);
                    logger.success(`[MULTIPLIER] Sent ${highest}x alert for ${symbol}`);
                }
                if (state.remainingTargets.length === 0) {
                    logger.info(`[MULTIPLIER] All targets hit for ${symbol}, stopping tracking`);
                    activeTrackers.delete(address);
                    return;
                }
            }
        }
        catch (error) {
            logger.warn(`[MULTIPLIER] Error tracking ${symbol}: ${error?.message || error}`);
        }
        await sleep(CHECK_INTERVAL_MS);
    }
}
function formatCurrencyShort(value) {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toFixed(0);
}
function formatMultiplierMessage(symbol, baseMc, currentMc, hitMultiple) {
    const baseStr = formatCurrencyShort(baseMc);
    const currentStr = formatCurrencyShort(currentMc);
    const proMultiple = (hitMultiple * 1.4).toFixed(1);
    let msg = '';
    msg += `💸 $${symbol} ${hitMultiple.toFixed(1)}x | ${proMultiple}x with PRO ⚡️\n`;
    msg += `📈 ${baseStr} → ${currentStr}\n`;
    return msg;
}
//# sourceMappingURL=multiplierTracker.js.map