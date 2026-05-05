import fs from 'fs';
import path from 'path';
import { FilterResult } from './filter.js';

interface PersistentWinrateStats {
  totalScans: number;
  totalFound: number;
  totalPassed: number;
  totalRejected: number;
  rejectedReasons: Record<string, number>;
  updatedAt: number;
}

interface SessionWinrateStats {
  startedAt: number;
  scans: number;
  found: number;
  passed: number;
  rejected: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STATS_FILE = path.join(DATA_DIR, 'winrate_stats.json');
const PASSED_TOKENS_FILE = path.join(DATA_DIR, 'passed_tokens.json');

const sessionStats: SessionWinrateStats = {
  startedAt: Date.now(),
  scans: 0,
  found: 0,
  passed: 0,
  rejected: 0
};

let persistentStats: PersistentWinrateStats = loadPersistentStats();

function loadPersistentStats(): PersistentWinrateStats {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STATS_FILE)) {
      return {
        totalScans: 0,
        totalFound: 0,
        totalPassed: 0,
        totalRejected: 0,
        rejectedReasons: {},
        updatedAt: Date.now()
      };
    }

    const raw = fs.readFileSync(STATS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistentWinrateStats>;
    return {
      totalScans: parsed.totalScans || 0,
      totalFound: parsed.totalFound || 0,
      totalPassed: parsed.totalPassed || 0,
      totalRejected: parsed.totalRejected || 0,
      rejectedReasons: parsed.rejectedReasons || {},
      updatedAt: parsed.updatedAt || Date.now()
    };
  } catch {
    return {
      totalScans: 0,
      totalFound: 0,
      totalPassed: 0,
      totalRejected: 0,
      rejectedReasons: {},
      updatedAt: Date.now()
    };
  }
}

function savePersistentStats(): void {
  try {
    persistentStats.updatedAt = Date.now();
    fs.writeFileSync(STATS_FILE, JSON.stringify(persistentStats, null, 2));
  } catch {
    // silent: stats persistence should never crash scanner runtime
  }
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.00%';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function getTopRejectReasons(limit = 5): Array<[string, number]> {
  return Object.entries(persistentStats.rejectedReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function getLegacyPassedTokenCount(): number {
  try {
    if (!fs.existsSync(PASSED_TOKENS_FILE)) {
      return 0;
    }
    const raw = fs.readFileSync(PASSED_TOKENS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function recordScan(): void {
  sessionStats.scans += 1;
  persistentStats.totalScans += 1;
  savePersistentStats();
}

export function recordFound(count: number): void {
  if (count <= 0) return;
  sessionStats.found += count;
  persistentStats.totalFound += count;
  savePersistentStats();
}

export function recordFilterOutcome(filterResult: FilterResult): void {
  if (filterResult.passed) {
    sessionStats.passed += 1;
    persistentStats.totalPassed += 1;
  } else {
    sessionStats.rejected += 1;
    persistentStats.totalRejected += 1;
    const reason = filterResult.reason || 'Unknown';
    persistentStats.rejectedReasons[reason] = (persistentStats.rejectedReasons[reason] || 0) + 1;
  }
  savePersistentStats();
}

export function buildWinrateMessage(): string {
  const lifetimeTotalProcessed = persistentStats.totalPassed + persistentStats.totalRejected;
  const sessionTotalProcessed = sessionStats.passed + sessionStats.rejected;
  const uptimeMinutes = Math.floor((Date.now() - sessionStats.startedAt) / 60000);
  const topReasons = getTopRejectReasons();
  const legacyPassedCount = getLegacyPassedTokenCount();

  let msg = '📈 <b>Winrate Report</b>\n\n';
  msg += '<b>Session</b>\n';
  msg += `• Uptime: ${uptimeMinutes}m\n`;
  msg += `• Scans: ${sessionStats.scans}\n`;
  msg += `• Found: ${sessionStats.found}\n`;
  msg += `• Passed: ${sessionStats.passed}\n`;
  msg += `• Rejected: ${sessionStats.rejected}\n`;
  msg += `• Winrate: ${formatPct(sessionStats.passed, sessionTotalProcessed)}\n\n`;

  msg += '<b>Lifetime (persisted)</b>\n';
  msg += `• Scans: ${persistentStats.totalScans}\n`;
  msg += `• Found: ${persistentStats.totalFound}\n`;
  msg += `• Passed: ${persistentStats.totalPassed}\n`;
  msg += `• Rejected: ${persistentStats.totalRejected}\n`;
  msg += `• Winrate: ${formatPct(persistentStats.totalPassed, lifetimeTotalProcessed)}\n`;
  msg += `• Legacy passed-token history: ${legacyPassedCount}\n`;

  if (topReasons.length > 0) {
    msg += '\n<b>Top rejection reasons</b>\n';
    topReasons.forEach(([reason, count], idx) => {
      msg += `${idx + 1}. ${reason} — ${count}\n`;
    });
  }

  return msg.trim();
}
