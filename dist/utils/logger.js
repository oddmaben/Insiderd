import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m'
};
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, `scanner-${new Date().toISOString().split('T')[0]}.log`);
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}
function timestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
function writeToFile(level, message, data) {
    if (!config.enableLogs)
        return;
    try {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data: data || undefined
        };
        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
    }
    catch (error) {
        console.error('[LOGGER] Failed to write to file:', error);
    }
}
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_SEND_INTERVAL_MS = 1200;
const TELEGRAM_BATCH_SIZE = 6;
const TELEGRAM_MAX_QUEUE = 400;
const telegramLogQueue = [];
let telegramSending = false;
let telegramLastSentAt = 0;
function stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;]*m/g, '');
}
function compactWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function enqueueTelegramLog(level, message) {
    if (!config.telegram.enableLogForwarding)
        return;
    if (!config.telegram.botToken || !config.telegram.logChatId)
        return;
    const cleaned = compactWhitespace(stripAnsi(message));
    if (!cleaned)
        return;
    telegramLogQueue.push(`[${level}] ${cleaned}`);
    if (telegramLogQueue.length > TELEGRAM_MAX_QUEUE) {
        telegramLogQueue.splice(0, telegramLogQueue.length - TELEGRAM_MAX_QUEUE);
    }
    void flushTelegramLogQueue();
}
async function flushTelegramLogQueue() {
    if (telegramSending)
        return;
    telegramSending = true;
    try {
        while (telegramLogQueue.length > 0) {
            const now = Date.now();
            const timeSinceLast = now - telegramLastSentAt;
            if (timeSinceLast < TELEGRAM_SEND_INTERVAL_MS) {
                await new Promise(resolve => setTimeout(resolve, TELEGRAM_SEND_INTERVAL_MS - timeSinceLast));
            }
            const lines = telegramLogQueue.splice(0, TELEGRAM_BATCH_SIZE);
            const text = `🛰 Insiderd Logs\n${lines.join('\n')}`;
            await fetch(`${TELEGRAM_API_BASE}/bot${config.telegram.botToken}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chat_id: config.telegram.logChatId,
                    text,
                    disable_web_page_preview: true
                })
            });
            telegramLastSentAt = Date.now();
        }
    }
    catch (error) {
        console.error('[LOGGER] Telegram log forwarding failed:', error);
    }
    finally {
        telegramSending = false;
    }
}
export const logger = {
    info: (msg, data) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}INFO${colors.reset}    ${msg}`);
        writeToFile('INFO', msg, data);
        enqueueTelegramLog('INFO', msg);
    },
    success: (msg, data) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}SUCCESS${colors.reset} ${msg}`);
        writeToFile('SUCCESS', msg, data);
        enqueueTelegramLog('SUCCESS', msg);
    },
    debug: (msg, data) => {
        writeToFile('DEBUG', msg, data);
        enqueueTelegramLog('DEBUG', msg);
    },
    warn: (msg, data) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}    ${msg}`);
        writeToFile('WARN', msg, data);
        enqueueTelegramLog('WARN', msg);
    },
    error: (msg, data) => {
        console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset}   ${msg}`);
        writeToFile('ERROR', msg, data);
        enqueueTelegramLog('ERROR', msg);
        if (data instanceof Error) {
            console.error(data.stack);
        }
    }
};
function rotateOldLogs() {
    try {
        if (!fs.existsSync(LOG_DIR))
            return;
        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        files.forEach(file => {
            const filePath = path.join(LOG_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
                console.log(`[LOGGER] Rotated old log: ${file}`);
            }
        });
    }
    catch (error) {
        console.error('[LOGGER] Failed to rotate logs:', error);
    }
}
rotateOldLogs();
//# sourceMappingURL=logger.js.map