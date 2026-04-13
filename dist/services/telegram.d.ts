import { TokenPair } from './scanner.js';
import { FilterResult } from './filter.js';
export declare function sendWithRetry(message: string, attempt?: number): Promise<boolean>;
export declare function initBot(): Promise<boolean>;
export declare function sendAlert(pair: TokenPair, filterResult: FilterResult): Promise<boolean>;
export declare function sendRawMessage(message: string): Promise<boolean>;
export declare function sendStartup(): Promise<void>;
export declare function sendErrorNotification(errorMsg: string): Promise<void>;
