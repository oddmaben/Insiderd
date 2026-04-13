import { config } from '../config.js';
import { logger } from '../utils/logger.js';
const BURN_ADDRESSES = [
    '11111111111111111111111111111111',
    'Dead111111111111111111111111111111111111111',
];
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const ALLOWED_LAUNCHPADS = [
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
    'dynamicbc',
    'raydium',
    'meteora',
    'pumpamm',
    'orca'
];
export async function isLiquidityLocked(pair) {
    try {
        const dexId = normalize(pair.dexId || '');
        const url = normalize(pair.url || '');
        const isAllowedLaunchpad = ALLOWED_LAUNCHPADS.some(launchpad => dexId.includes(launchpad) || url.includes(launchpad));
        if (isAllowedLaunchpad) {
            logger.debug(`✅ ${pair.baseToken.symbol}: Allowed launchpad (${pair.dexId})`);
            return true;
        }
        logger.debug(`❌ ${pair.baseToken.symbol}: Unsupported launchpad (${pair.dexId})`);
        return false;
    }
    catch (error) {
        logger.warn(`Failed to check LP lock for ${pair.baseToken.symbol}:`, error);
        return false;
    }
}
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9.]/g, '');
}
async function rpcCall(method, params) {
    try {
        const response = await fetch(config.api.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method,
                params
            })
        });
        const json = await response.json();
        return json.result;
    }
    catch (error) {
        return null;
    }
}
//# sourceMappingURL=liquidityCheck.js.map