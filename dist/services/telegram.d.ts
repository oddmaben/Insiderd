import { TokenPair } from './scanner.js';
import { FilterResult } from './filter.js';
interface SendOptions {
    photoUrl?: string;
    replyToMessageId?: number;
    chatId?: string;
}
export declare function sendWithRetry(message: string, attempt?: number): Promise<boolean>;
export declare function initBot(): Promise<boolean>;
export declare function sendAlert(pair: TokenPair, filterResult: FilterResult): Promise<boolean>;
export declare function sendRawMessage(message: string): Promise<boolean>;
export declare function sendRawCallMessage(message: string, options?: SendOptions): Promise<number | null>;
export declare function sendTokenEvaluationLog(pair: TokenPair, filterResult: FilterResult): Promise<void>;
export declare function sendMissedWinnerLog(pair: TokenPair, status: 'PASSED' | 'REJECTED', reason: string | undefined, baseMc: number, currentMc: number, elapsedMinutes: number): Promise<void>;
export declare function sendStartup(): Promise<void>;
export declare function sendErrorNotification(errorMsg: string): Promise<void>;
export {};
