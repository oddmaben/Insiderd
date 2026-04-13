import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TokenPair } from './scanner.js';
import { FilterResult, formatCurrency } from './filter.js';
import { formatAge, getAgeMinutes } from './scanner.js';
import { startMultiplierTracking } from './multiplierTracker.js';

let bot: Telegraf;
let isReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const MESSAGE_RATE_LIMIT = 1000;
let lastMessageTime = 0;

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;
  
  if (timeSinceLastMessage < MESSAGE_RATE_LIMIT) {
    const waitTime = MESSAGE_RATE_LIMIT - timeSinceLastMessage;
    logger.info(`[RATE LIMIT] Waiting ${waitTime}ms...`);
    await new Promise(r => setTimeout(r, waitTime));
  }
  
  lastMessageTime = Date.now();
}

interface SendOptions {
  photoUrl?: string;
  replyToMessageId?: number;
  chatId?: string;
}

function getDexscreenerImageUrl(pair: TokenPair): string {
  if (pair.info?.imageUrl) {
    return pair.info.imageUrl;
  }
  return `https://dd.dexscreener.com/ds-data/tokens/solana/${pair.baseToken.address}.png`;
}

function splitMessage(message: string): string[] {
  const MAX_LENGTH = 4000;
  
  if (message.length <= MAX_LENGTH) {
    return [message];
  }
  
  const parts: string[] = [];
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

export async function sendWithRetry(
  message: string,
  attempt = 1
): Promise<boolean> {
  try {
    await bot.telegram.sendMessage(config.telegram.channelId, message, {
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: true
      }
    });
    
    return true;
    
  } catch (error: any) {
    if (attempt >= 3) {
      logger.error(`[TELEGRAM] Failed after 3 attempts:`, error.message);
      return false;
    }
    
    logger.warn(`[TELEGRAM] Retry ${attempt}/3...`);
    
    await new Promise(r => setTimeout(r, 1000 * attempt));
    
    return sendWithRetry(message, attempt + 1);
  }
}

async function sendCallWithRetry(
  message: string,
  options: SendOptions = {},
  attempt = 1
): Promise<number | null> {
  const targetChatId = options.chatId || config.telegram.channelId;

  try {
    const payloadBase = {
      parse_mode: 'HTML' as const,
      link_preview_options: {
        is_disabled: true
      },
      ...(options.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {})
    };

    if (options.photoUrl) {
      const sent = await bot.telegram.sendPhoto(
        targetChatId,
        options.photoUrl,
        {
          caption: message.slice(0, 1024),
          parse_mode: 'HTML',
          ...(options.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {})
        }
      );
      return sent.message_id;
    }

    const sent = await bot.telegram.sendMessage(targetChatId, message, payloadBase);
    return sent.message_id;
  } catch (error: any) {
    if (options.photoUrl) {
      logger.warn('[TELEGRAM] Photo send failed, retrying as text message');
      return sendCallWithRetry(message, {
        ...options,
        photoUrl: undefined
      }, attempt + 1);
    }

    if (attempt >= 3) {
      logger.error(`[TELEGRAM] Call send failed after 3 attempts:`, error.message);
      return null;
    }

    logger.warn(`[TELEGRAM] Call send retry ${attempt}/3...`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
    return sendCallWithRetry(message, options, attempt + 1);
  }
}

export async function initBot(): Promise<boolean> {
  try {
    bot = new Telegraf(config.telegram.botToken);

    bot.catch((err: any) => {
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
      } catch (error: any) {
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

  } catch (error: any) {
    logger.error('Failed to initialize bot:', error.message);
    return false;
  }
}

export async function sendAlert(
  pair: TokenPair,
  filterResult: FilterResult
): Promise<boolean> {
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
    const photoUrl = getDexscreenerImageUrl(pair);
    await rateLimitWait();
    const messageId = await sendCallWithRetry(message, { photoUrl });

    if (!messageId) {
      logger.error(`Failed to send alert for ${pair.baseToken.symbol}`);
      return false;
    }
    
    logger.success(`📤 Alert sent: ${pair.baseToken.symbol}`);
    await pinPassedAlert(messageId);
    startMultiplierTracking(pair, {
      initialMessageId: messageId,
      photoUrl
    });
    reconnectAttempts = 0;
    return true;

  } catch (error: any) {
    logger.error('Error sending alert:', error.message);
    
    if (error.code === 'EFATAL' || error.code === 'ECONNRESET') {
      logger.warn('Network error, attempting reconnect...');
      
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        isReady = false;
        await new Promise(r => setTimeout(r, 3000));
        await initBot();
      } else {
        logger.error('Max reconnect attempts reached');
      }
    }
    
    return false;
  }
}

function formatMessage(pair: TokenPair, filterResult: FilterResult): string {
  const symbol = pair.baseToken.symbol;
  const name = pair.baseToken.name;
  const ageMinutes = pair.pairCreatedAt ? getAgeMinutes(pair.pairCreatedAt) : 0;
  const age = pair.pairCreatedAt ? formatAge(ageMinutes) : 'Unknown';

  const liquidity = formatCurrency(filterResult.stats.liquidity);
  const volume5m = formatCurrency(filterResult.stats.volume5m);

  const mc = pair.fdv ? formatCurrency(pair.fdv) : liquidity;

  let msg = '';

  msg += `<b>✅ INSIDER PASS CALL</b>\n`;
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

  msg += `\n${pair.url}\n`;
  msg += `\nPM @DCKXE for Insider access.`;

  return msg;
}

function formatTokenEvaluationLog(pair: TokenPair, filterResult: FilterResult): string {
  const status = filterResult.passed ? '✅ PASS' : '❌ FAIL';
  const reason = filterResult.passed ? 'All active filters passed' : (filterResult.reason || 'Unknown rejection');
  const mc = formatCurrency(filterResult.stats.marketCap);
  const liq = formatCurrency(filterResult.stats.liquidity);
  const vol = formatCurrency(filterResult.stats.volume5m);

  let msg = '';
  msg += `<b>${status}</b> • $${pair.baseToken.symbol}\n`;
  msg += `${pair.baseToken.name}\n`;
  msg += `<code>${pair.baseToken.address}</code>\n\n`;
  msg += `Reason: ${reason}\n`;
  msg += `MC: ${mc} | Liq: ${liq} | Vol5m: ${vol}\n`;
  msg += `Dex: ${pair.dexId || 'unknown'}\n`;
  msg += `${pair.url}`;

  return msg;
}

async function pinPassedAlert(messageId: number): Promise<void> {
  try {
    await bot.telegram.pinChatMessage(config.telegram.channelId, messageId, {
      disable_notification: true
    });
    logger.success(`[TELEGRAM] Pinned passed alert (${messageId})`);
  } catch (error: any) {
    logger.warn(`[TELEGRAM] Could not pin alert (${messageId}): ${error?.message || error}`);
  }
}

export async function sendRawMessage(message: string): Promise<boolean> {
  const messageId = await sendRawCallMessage(message);
  return messageId !== null;
}

export async function sendRawCallMessage(
  message: string,
  options: SendOptions = {}
): Promise<number | null> {
  if (!isReady) {
    const reconnected = await initBot();
    if (!reconnected) {
      logger.error('Failed to (re)initialize bot for raw message');
      return null;
    }
  }

  try {
    await rateLimitWait();
    return await sendCallWithRetry(message, options);
  } catch (error: any) {
    logger.error('Error sending raw message:', error.message);
    return null;
  }
}

export async function sendTokenEvaluationLog(
  pair: TokenPair,
  filterResult: FilterResult
): Promise<void> {
  if (!isReady) {
    const reconnected = await initBot();
    if (!reconnected) {
      logger.warn('[TELEGRAM] Skipping token evaluation log: bot not ready');
      return;
    }
  }

  const message = formatTokenEvaluationLog(pair, filterResult);
  const photoUrl = getDexscreenerImageUrl(pair);

  await sendCallWithRetry(message, {
    photoUrl,
    chatId: config.telegram.logChatId
  });
}

export async function sendMissedWinnerLog(
  pair: TokenPair,
  status: 'PASSED' | 'REJECTED',
  reason: string | undefined,
  baseMc: number,
  currentMc: number,
  elapsedMinutes: number
): Promise<void> {
  if (!isReady) {
    const reconnected = await initBot();
    if (!reconnected) {
      logger.warn('[TELEGRAM] Skipping 3x performance log: bot not ready');
      return;
    }
  }

  const multiple = baseMc > 0 ? (currentMc / baseMc).toFixed(2) : '0.00';
  const context = status === 'REJECTED' ? `Rejected reason: ${reason || 'Unknown'}` : 'Token was passed and alerted.';
  const msg = `🚨 <b>3X PERFORMANCE HIT</b>\n` +
              `$${pair.baseToken.symbol} hit <b>${multiple}x</b> in ${elapsedMinutes.toFixed(1)}m\n` +
              `Base MC: ${formatCurrency(baseMc)} → Current MC: ${formatCurrency(currentMc)}\n` +
              `Status: ${status}\n` +
              `${context}\n` +
              `${pair.url}`;

  await sendCallWithRetry(msg, {
    photoUrl: getDexscreenerImageUrl(pair),
    chatId: config.telegram.logChatId
  });
}

export async function sendStartup(): Promise<void> {
  if (!isReady) return;
  
  if (!config.telegram.sendStartupMessage) {
    logger.info('Startup message disabled (SEND_STARTUP_MESSAGE=false)');
    return;
  }

  try {
    const msg = `✅ <b>Insider Dinero Updated</b>\n\n` +
                `New bot update has been deployed and is now live.\n\n` +
                `<b>Filter Settings:</b>\n` +
                `Min Liquidity: ${formatCurrency(config.scanner.minLiquidity)}\n` +
                `Min Volume (5m): ${formatCurrency(config.scanner.minVolume5m)}\n` +
                `Max Age: ${config.scanner.maxAgeMinutes} minutes\n\n` +
                `Waiting for new tokens...`;

    await sendWithRetry(msg);
    logger.info('Startup message sent');
  } catch (error: any) {
    logger.warn('Could not send startup message:', error.message);
  }
}

export async function sendErrorNotification(errorMsg: string): Promise<void> {
  if (!isReady) return;

  try {
    const msg = `⚠️ <b>Scanner Error</b>\n\n${errorMsg}\n\n<i>Scanner continues running...</i>`;
    await sendWithRetry(msg);
  } catch {
    
  }
}
