import dotenv from 'dotenv';
dotenv.config();
function getEnvString(key, defaultValue) {
    const value = process.env[key];
    if (!value && !defaultValue) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return (value || defaultValue);
}
function getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    if (!value)
        return defaultValue;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        console.warn(`Invalid number for ${key}, using default: ${defaultValue}`);
        return defaultValue;
    }
    return parsed;
}
function getEnvStringList(key) {
    const value = process.env[key];
    if (!value)
        return [];
    return value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}
export const config = {
    telegram: {
        botToken: getEnvString('TELEGRAM_BOT_TOKEN'),
        channelId: getEnvString('TELEGRAM_CHANNEL_ID'),
        sendStartupMessage: process.env.SEND_STARTUP_MESSAGE === 'true',
        logChatId: getEnvString('TELEGRAM_LOG_CHAT_ID', '@DCKXE'),
        logUserId: process.env.TELEGRAM_LOG_USER_ID || undefined,
        enableLogForwarding: process.env.ENABLE_TELEGRAM_LOG_FORWARDING !== 'false'
    },
    scanner: {
        pollInterval: getEnvNumber('POLL_INTERVAL', getEnvNumber('APIFY_POLL_INTERVAL_MS', 2500)),
        minLiquidity: getEnvNumber('MIN_LIQUIDITY', 800),
        minVolume5m: getEnvNumber('MIN_VOLUME', 5000),
        maxAgeMinutes: getEnvNumber('MAX_AGE', 7),
        minMarketCap: getEnvNumber('MIN_MARKET_CAP', 15000),
        maxMarketCap: getEnvNumber('MAX_MARKET_CAP', 300000)
    },
    api: {
        dexscreener: 'https://api.dexscreener.com',
        birdeye: 'https://public-api.birdeye.so',
        birdeyeApiKey: process.env.BIRDEYE_API_KEY || undefined,
        apifyEnabled: process.env.ENABLE_APIFY === 'true' || Boolean(process.env.APIFY_API_TOKEN && process.env.APIFY_ACTOR_ID),
        apifyApiToken: process.env.APIFY_API_TOKEN || undefined,
        apifyActorId: process.env.APIFY_ACTOR_ID || undefined,
        apifyChain: (process.env.APIFY_CHAIN || 'solana').toLowerCase(),
        apifyMaxItems: getEnvNumber('APIFY_MAX_ITEMS', 100),
        apifyTokenAddresses: getEnvStringList('APIFY_TOKEN_ADDRESSES'),
        solscan: 'https://api.solscan.io',
        rpcUrl: getEnvString('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')
    },
    enableLogs: process.env.ENABLE_LOGS !== 'false'
};
if (!config.telegram.botToken || !config.telegram.channelId) {
    console.error('ERROR: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID in .env');
    process.exit(1);
}
console.log('[CONFIG] Configuration loaded successfully');
console.log(`[CONFIG] Poll interval: ${config.scanner.pollInterval}ms`);
console.log(`[CONFIG] Min liquidity: $${config.scanner.minLiquidity}`);
console.log(`[CONFIG] Min volume (5m): $${config.scanner.minVolume5m}`);
console.log(`[CONFIG] Market cap range: $${config.scanner.minMarketCap} - $${config.scanner.maxMarketCap}`);
console.log(`[CONFIG] Apify enabled: ${config.api.apifyEnabled}`);
//# sourceMappingURL=config.js.map