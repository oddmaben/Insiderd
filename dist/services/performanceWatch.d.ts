import { TokenPair } from './scanner.js';
interface WatchContext {
    status: 'PASSED' | 'REJECTED';
    reason?: string;
}
export declare function startPerformanceWatch(pair: TokenPair, context: WatchContext): void;
export {};
