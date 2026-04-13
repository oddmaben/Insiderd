import { logger } from '../utils/logger.js';
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens';
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
    try {
        const url = `${RUGCHECK_API}/${mint}/report/summary`;
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
            logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck unavailable (${response.status})`);
            return false;
        }
        const data = await response.json();
        const score = data.score || 0;
        if (score > 1500) {
            logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: High RugCheck Score (${score})`);
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
    }
    catch (error) {
        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: RugCheck API failed`);
        return false;
    }
}
//# sourceMappingURL=rugcheck.js.map