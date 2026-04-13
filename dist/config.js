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
export const config = {
    telegram: {
        botToken: getEnvString('TELEGRAM_BOT_TOKEN'),
        channelId: getEnvString('TELEGRAM_CHANNEL_ID'),
        sendStartupMessage: process.env.SEND_STARTUP_MESSAGE === 'true',
        logChatId: getEnvString('TELEGRAM_LOG_CHAT_ID', '@DCKXE'),
        enableLogForwarding: process.env.ENABLE_TELEGRAM_LOG_FORWARDING !== 'false'
    },
    scanner: {
        pollInterval: getEnvNumber('POLL_INTERVAL', 2500),
        minLiquidity: getEnvNumber('MIN_LIQUIDITY', 800),
        minVolume5m: getEnvNumber('MIN_VOLUME', 5000),
        maxAgeMinutes: getEnvNumber('MAX_AGE', 7),
        minMarketCap: getEnvNumber('MIN_MARKET_CAP', 15000),
        maxMarketCap: getEnvNumber('MAX_MARKET_CAP', 300000)
    },
    api: {
        dexscreener: 'https://api.dexscreener.com/latest/dex',
        birdeye: 'https://public-api.birdeye.so/public',
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
//# sourceMappingURL=config.js.map