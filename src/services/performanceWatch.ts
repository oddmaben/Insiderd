import { sleep } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import { TokenPair } from './scanner.js';
import { sendMissedWinnerLog } from './telegram.js';
import { getBirdeyeTokenSnapshot } from './birdeye.js';

interface WatchContext {
  status: 'PASSED' | 'REJECTED';
  reason?: string;
}

interface WatchState {
  baseMc: number;
  startedAt: number;
  context: WatchContext;
}

const TARGET_MULTIPLE = 3;
const WATCH_WINDOW_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 45_000;

const activeWatches = new Map<string, WatchState>();

function getBaseMc(pair: TokenPair): number {
  if (pair.fdv && pair.fdv > 0) {
    return pair.fdv;
  }
  const liquidity = pair.liquidity?.usd ?? 0;
  return liquidity * 10;
}

export function startPerformanceWatch(pair: TokenPair, context: WatchContext): void {
  const watchKey = pair.pairAddress;
  if (activeWatches.has(watchKey)) {
    return;
  }

  const baseMc = getBaseMc(pair);
  if (!baseMc || baseMc <= 0) {
    return;
  }

  const state: WatchState = {
    baseMc,
    startedAt: Date.now(),
    context
  };

  activeWatches.set(watchKey, state);
  void monitorTokenPerformance(pair, watchKey, state);
}

async function monitorTokenPerformance(pair: TokenPair, watchKey: string, state: WatchState): Promise<void> {
  while (true) {
    if (!activeWatches.has(watchKey)) {
      return;
    }

    const elapsedMs = Date.now() - state.startedAt;
    if (elapsedMs > WATCH_WINDOW_MS) {
      activeWatches.delete(watchKey);
      return;
    }

    try {
      const snapshot = await getBirdeyeTokenSnapshot(pair.baseToken.address);
      const currentMc = snapshot?.fdv || snapshot?.marketCap || 0;
      if (currentMc > 0) {
        const multiple = currentMc / state.baseMc;
        if (multiple >= TARGET_MULTIPLE) {
          const elapsedMinutes = elapsedMs / 60000;
          await sendMissedWinnerLog(
            pair,
            state.context.status,
            state.context.reason,
            state.baseMc,
            currentMc,
            elapsedMinutes
          );
          logger.warn(
            `[PERF] ${pair.baseToken.symbol} hit ${multiple.toFixed(2)}x in ${elapsedMinutes.toFixed(1)}m (${state.context.status})`
          );
          activeWatches.delete(watchKey);
          return;
        }
      }
    } catch (error: any) {
      logger.debug(`[PERF] Watch check failed for ${pair.baseToken.symbol}: ${error?.message || error}`);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}

