import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { formatCurrency } from './filter.js';
import { formatAge, getAgeMinutes } from './scanner.js';
import { startMultiplierTracking } from './multiplierTracker.js';
let bot;
let isReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const MESSAGE_RATE_LIMIT = 1000;
let lastMessageTime = 0;
async function rateLimitWait() {
    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTime;
    if (timeSinceLastMessage < MESSAGE_RATE_LIMIT) {
        const waitTime = MESSAGE_RATE_LIMIT - timeSinceLastMessage;
        logger.info(`[RATE LIMIT] Waiting ${waitTime}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
    }
    lastMessageTime = Date.now();
}
function splitMessage(message) {
    const MAX_LENGTH = 4000;
    if (message.length <= MAX_LENGTH) {
        return [message];
    }
    const parts = [];
    let currentPart = '';
    const lines = message.split('\n');
    for (const line of lines) {
        if ((currentPart + line + '\n').length > MAX_LENGTH) {
            if (currentPart) {
                parts.push(currentPart.trim());
                currentPart = '';
            }
        }
        currentPart += line + '\n';
    }
    if (currentPart) {
        parts.push(currentPart.trim());
    }
    return parts;
}
export async function sendWithRetry(message, attempt = 1) {
    try {
        await bot.telegram.sendMessage(config.telegram.channelId, message, {
            parse_mode: 'HTML',
            link_preview_options: {
                is_disabled: true
            }
        });
        return true;
    }
    catch (error) {
        if (attempt >= 3) {
            logger.error(`[TELEGRAM] Failed after 3 attempts:`, error.message);
            return false;
        }
        logger.warn(`[TELEGRAM] Retry ${attempt}/3...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return sendWithRetry(message, attempt + 1);
    }
}
export async function initBot() {
    try {
        bot = new Telegraf(config.telegram.botToken);
        bot.catch((err) => {
            logger.error('Telegram bot error (caught):', err.message);
            if (err.code === 'EFATAL' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
                logger.warn('Network error detected, will retry...');
            }
        });
        let connected = false;
        for (let i = 0; i < 3; i++) {
            try {
                const me = await bot.telegram.getMe();
                logger.success(`✅ Bot connected: @${me.username}`);
                connected = true;
                break;
            }
            catch (error) {
                logger.warn(`Connection attempt ${i + 1}/3 failed, retrying...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        if (!connected) {
            throw new Error('Failed to connect after 3 attempts');
        }
        isReady = true;
        reconnectAttempts = 0;
        return true;
    }
    catch (error) {
        logger.error('Failed to initialize bot:', error.message);
        return false;
    }
}
export async function sendAlert(pair, filterResult) {
    if (!isReady) {
        logger.warn('Bot not ready, attempting to reconnect...');
        const reconnected = await initBot();
        if (!reconnected) {
            logger.error('Failed to reconnect, skipping alert');
            return false;
        }
    }
    try {
        const message = formatMessage(pair, filterResult);
        const parts = splitMessage(message);
        logger.info(`[TELEGRAM] Sending ${parts.length} message part(s)...`);
        for (let i = 0; i < parts.length; i++) {
            await rateLimitWait();
            const sent = await sendWithRetry(parts[i]);
            if (!sent) {
                logger.error(`Failed to send part ${i + 1}/${parts.length}`);
                return false;
            }
            logger.info(`Sent part ${i + 1}/${parts.length}`);
        }
        logger.success(`📤 Alert sent: ${pair.baseToken.symbol}`);
        startMultiplierTracking(pair);
        reconnectAttempts = 0;
        return true;
    }
    catch (error) {
        logger.error('Error sending alert:', error.message);
        if (error.code === 'EFATAL' || error.code === 'ECONNRESET') {
            logger.warn('Network error, attempting reconnect...');
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                isReady = false;
                await new Promise(r => setTimeout(r, 3000));
                await initBot();
            }
            else {
                logger.error('Max reconnect attempts reached');
            }
        }
        return false;
    }
}
function formatMessage(pair, filterResult) {
    const symbol = pair.baseToken.symbol;
    const name = pair.baseToken.name;
    const ageMinutes = pair.pairCreatedAt ? getAgeMinutes(pair.pairCreatedAt) : 0;
    const age = pair.pairCreatedAt ? formatAge(ageMinutes) : 'Unknown';
    const liquidity = formatCurrency(filterResult.stats.liquidity);
    const volume5m = formatCurrency(filterResult.stats.volume5m);
    const mc = pair.fdv ? formatCurrency(pair.fdv) : liquidity;
    let msg = '';
    msg += `Insider Dinero\n`;
    msg += `${name}\n`;
    msg += `${pair.baseToken.address}\n\n`;
    msg += `💰 Token Overview\n`;
    msg += `├ MC: ${mc} | ⏳ ${age}\n`;
    msg += `├ Volume: ${volume5m} | 🟢 ? | 🔴 ?\n`;
    msg += `└ Bonding: 96.48%\n\n`;
    msg += `🔓 Join Insider Program!\n`;
    msg += `├🚀 Faster signals, earlier entries\n`;
    msg += `├🧬 Dev wallet, smart money tracking\n`;
    msg += `├👤 Community, holders, 𝕏 insights\n`;
    msg += `└⚡️Activate auto buy trading bots\n`;
    msg += `\n${pair.url}`;
    return msg;
}
export async function sendRawMessage(message) {
    if (!isReady) {
        const reconnected = await initBot();
        if (!reconnected) {
            logger.error('Failed to (re)initialize bot for raw message');
            return false;
        }
    }
    try {
        const parts = splitMessage(message);
        for (let i = 0; i < parts.length; i++) {
            await rateLimitWait();
            const sent = await sendWithRetry(parts[i]);
            if (!sent) {
                logger.error(`Failed to send raw part ${i + 1}/${parts.length}`);
                return false;
            }
        }
        return true;
    }
    catch (error) {
        logger.error('Error sending raw message:', error.message);
        return false;
    }
}
export async function sendStartup() {
    if (!isReady)
        return;
    if (!config.telegram.sendStartupMessage) {
        logger.info('Startup message disabled (SEND_STARTUP_MESSAGE=false)');
        return;
    }
    try {
        const msg = `🤖 <b>Meme Coin Scanner v3.0 Started</b>\n\n` +
            `✅ Production mode active\n` +
            `✅ All protections enabled\n\n` +
            `<b>Filter Settings:</b>\n` +
            `Min Liquidity: ${formatCurrency(config.scanner.minLiquidity)}\n` +
            `Min Volume (5m): ${formatCurrency(config.scanner.minVolume5m)}\n` +
            `Max Age: ${config.scanner.maxAgeMinutes} minutes\n\n` +
            `Waiting for new tokens...`;
        await sendWithRetry(msg);
        logger.info('Startup message sent');
    }
    catch (error) {
        logger.warn('Could not send startup message:', error.message);
    }
}
export async function sendErrorNotification(errorMsg) {
    if (!isReady)
        return;
    try {
        const msg = `⚠️ <b>Scanner Error</b>\n\n${errorMsg}\n\n<i>Scanner continues running...</i>`;
        await sendWithRetry(msg);
    }
    catch {
    }
}
//# sourceMappingURL=telegram.js.map