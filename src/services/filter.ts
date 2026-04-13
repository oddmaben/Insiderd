import { TokenPair } from './scanner.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface FilterResult {
  passed: boolean;
  reason?: string;
  warnings: string[];
  stats: {
    liquidity: number;
    volume5m: number;
    priceChange: number;
    marketCap: number;
  };
}

export function filterToken(pair: TokenPair): FilterResult {
  const warnings: string[] = [];
  const symbol = pair.baseToken.symbol;

  const liquidity = pair.liquidity?.usd || 0;
  const volume5m = pair.volume?.m5 || 0;
  const priceChange = pair.priceChange?.m5 || 0;
  const marketCap = pair.fdv || 0;

  const stats = { liquidity, volume5m, priceChange, marketCap };

  logger.info(`🔍 Filtering: ${symbol}`);
  logger.info(`   Liquidity: ${formatCurrency(liquidity)}`);
  logger.info(`   Volume 5m: ${formatCurrency(volume5m)}`);
  logger.info(`   Market Cap: ${formatCurrency(marketCap)}`);

  if (liquidity < config.scanner.minLiquidity) {
    logger.warn(`❌ ${symbol} REJECTED: Low liquidity ($${liquidity.toFixed(0)} < $${config.scanner.minLiquidity})`);
    return {
      passed: false,
      reason: `Low liquidity: ${formatCurrency(liquidity)}`,
      warnings,
      stats
    };
  }

  if (volume5m < config.scanner.minVolume5m) {
    logger.warn(`❌ ${symbol} REJECTED: Low volume ($${volume5m.toFixed(0)} < $${config.scanner.minVolume5m})`);
    return {
      passed: false,
      reason: `Low volume: ${formatCurrency(volume5m)}`,
      warnings,
      stats
    };
  }

  if (marketCap < config.scanner.minMarketCap) {
    logger.warn(`❌ ${symbol} REJECTED: Low market cap ($${marketCap.toFixed(0)} < $${config.scanner.minMarketCap})`);
    return {
      passed: false,
      reason: `Low market cap: ${formatCurrency(marketCap)}`,
      warnings,
      stats
    };
  }

  if (marketCap > config.scanner.maxMarketCap) {
    logger.warn(`❌ ${symbol} REJECTED: High market cap ($${marketCap.toFixed(0)} > $${config.scanner.maxMarketCap})`);
    return {
      passed: false,
      reason: `High market cap: ${formatCurrency(marketCap)}`,
      warnings,
      stats
    };
  }

  const fdv = pair.fdv || 0;
  if (fdv > 0 && liquidity > 0) {
    const ratio = fdv / liquidity;
    if (ratio > 1000) {
      logger.warn(`❌ ${symbol} REJECTED: Suspicious FDV/Liquidity ratio (${ratio.toFixed(0)}x)`);
      return {
        passed: false,
        reason: `Suspicious FDV/Liquidity ratio (Potential Scam)`,
        warnings,
        stats
      };
    }
  }

  if (priceChange > 300 && volume5m < 1000) {
    logger.warn(`❌ ${symbol} REJECTED: Honeypot pattern (High pump, low volume)`);
    return {
      passed: false,
      reason: `Honeypot pattern detected`,
      warnings,
      stats
    };
  }

  if (priceChange > 200) {
    warnings.push(`⚠️ Extreme pump: +${priceChange.toFixed(0)}%`);
    logger.warn(`⚠️ ${symbol}: Extreme pump detected (+${priceChange.toFixed(0)}%)`);
  } else if (priceChange > 100) {
    warnings.push(`⚠️ High pump: +${priceChange.toFixed(0)}%`);
  }

  if (pair.pairCreatedAt) {
    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
    if (ageMinutes < 2) {
      warnings.push('⚠️ Very new (<2m)');
      logger.warn(`⚠️ ${symbol}: Very new token (${ageMinutes.toFixed(1)}m)`);
    }
  }

  if (liquidity < 1000) {
    warnings.push('⚠️ Low liquidity');
  }

  if (volume5m < 200) {
    warnings.push('⚠️ Low volume');
  }

  logger.success(`✅ ${symbol} PASSED all filters!`);
  
  if (warnings.length > 0) {
    logger.warn(`⚠️ ${symbol} has ${warnings.length} warning(s)`);
  }

  return {
    passed: true,
    warnings,
    stats
  };
}

export function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}
