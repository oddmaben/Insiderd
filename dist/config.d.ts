interface TelegramConfig {
    botToken: string;
    channelId: string;
    sendStartupMessage: boolean;
}
interface ScannerConfig {
    pollInterval: number;
    minLiquidity: number;
    minVolume5m: number;
    maxAgeMinutes: number;
    minMarketCap: number;
    maxMarketCap: number;
}
interface ApiConfig {
    dexscreener: string;
    birdeye: string;
    solscan: string;
    rpcUrl: string;
}
export interface Config {
    telegram: TelegramConfig;
    scanner: ScannerConfig;
    api: ApiConfig;
    enableLogs: boolean;
}
export declare const config: Config;
export {};
