export interface TokenPair {
    chainId: string;
    dexId: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        symbol: string;
    };
    priceUsd?: string;
    fdv?: number;
    liquidity?: {
        usd: number;
        base?: number;
        quote?: number;
    };
    volume?: {
        m5: number;
        h1: number;
        h24: number;
    };
    priceChange?: {
        m5: number;
    };
    pairCreatedAt?: number;
    url: string;
    info?: {
        imageUrl?: string;
    };
}
export declare function fetchNewPairs(): Promise<TokenPair[]>;
export declare function refreshPairData(pair: TokenPair): Promise<TokenPair>;
export declare function getAgeMinutes(createdAt: number): number;
export declare function formatAge(minutes: number): string;
export declare function getCacheStats(): {
    size: number;
    oldest: number;
};
export declare function clearCache(): void;
