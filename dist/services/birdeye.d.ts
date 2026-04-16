export interface BirdeyeTokenSnapshot {
    liquidityUsd: number;
    marketCap: number;
    fdv: number;
    volume5mUsd: number;
    priceUsd: number;
    logoUrl?: string;
    name?: string;
    symbol?: string;
    lastTradeUnixTime?: number;
    recentListingUnixTime?: number;
}
export interface BirdeyeTokenListItem {
    address: string;
    logo_uri?: string;
    name?: string;
    symbol?: string;
    liquidity?: number;
    market_cap?: number;
    fdv?: number;
    volume_5m_usd?: number;
    price?: number;
    price_change_5m_percent?: number;
    last_trade_unix_time?: number;
    recent_listing_time?: number;
}
export declare function getBirdeyeLiquidityUsd(tokenMint: string): Promise<number | null>;
export declare function getBirdeyeTokenSnapshot(tokenMint: string): Promise<BirdeyeTokenSnapshot | null>;
export declare function getBirdeyeTokenList(limit?: number, offset?: number): Promise<BirdeyeTokenListItem[]>;
export declare function clearBirdeyeCache(): void;
