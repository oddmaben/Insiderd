import { TokenPair } from './scanner.js';
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
export declare function filterToken(pair: TokenPair): FilterResult;
export declare function formatCurrency(value: number): string;
