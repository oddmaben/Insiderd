import { TokenPair } from './scanner.js';
interface StartTrackingOptions {
    initialMessageId?: number;
    photoUrl?: string;
}
export declare function startMultiplierTracking(pair: TokenPair, options?: StartTrackingOptions): void;
export {};
