export interface DexScreenerPair {
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
    marketCap?: number;
    liquidity?: {
        usd?: number | string;
        base?: number | string;
        quote?: number | string;
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
export declare function searchDexPairs(query: string): Promise<DexScreenerPair[]>;
export declare function getDexPair(chainId: string, pairAddress: string): Promise<DexScreenerPair | null>;
export declare function getDexTokenPairs(chainId: string, tokenAddress: string): Promise<DexScreenerPair[]>;
export declare function getDexTokenPairsExpanded(chainId: string, tokenAddress: string): Promise<DexScreenerPair[]>;
