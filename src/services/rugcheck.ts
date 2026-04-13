import { logger } from '../utils/logger.js';
import { TokenPair } from './scanner.js';
import { config } from '../config.js';
import { sleep } from '../utils/fetch.js';

const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens';
const RUGCHECK_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([400, 429, 500, 502, 503, 504]);

interface RugCheckReport {
  score: number;
  risks: {
    name: string;
    value: string;
    level: string;
    score: number;
  }[];
  tokenProgram: string;
  tokenType: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

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

export async function checkRugStatus(pair: TokenPair): Promise<boolean> {
  const mint = pair.baseToken.address;
  
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
            return false;
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
            return true;
          }

          logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck unavailable (${response.status})`);
          return false;
        }

        const data = await response.json() as RugCheckReport;
        const score = data.score || 0;
        
        if (score > config.security.maxRugcheckScore) {
          logger.warn(
            `❌ ${pair.baseToken.symbol} REJECTED: High RugCheck Score (${score} > ${config.security.maxRugcheckScore})`
          );
          return false;
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
          return false;
        }

        if (blockedRisks.length > 0) {
          const riskNames = blockedRisks.map((r) => r.name).join(', ');
          logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Blocklisted Risks (${riskNames})`);
          return false;
        }

        logger.debug(`✅ ${pair.baseToken.symbol}: RugCheck Passed (Score: ${score})`);
        return true;
      } catch (error) {
        if (attempt < RUGCHECK_MAX_ATTEMPTS) {
          const delay = 500 * attempt;
          logger.debug(`RugCheck network retry ${attempt}/${RUGCHECK_MAX_ATTEMPTS - 1} for ${pair.baseToken.symbol}`);
          await sleep(delay);
          continue;
        }
        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck API failed`);
        return false;
      }
    }

    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck exhausted retries`);
    return false;
  } catch {
    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck setup failed`);
    return false;
  }
}
