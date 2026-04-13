interface TelegramConfig {
    botToken: string;
    channelId: string;
    sendStartupMessage: boolean;
    logChatId: string;
    enableLogForwarding: boolean;
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
interface SecurityConfig {
    maxRugcheckScore: number;
}
export interface Config {
    telegram: TelegramConfig;
    scanner: ScannerConfig;
    api: ApiConfig;
    security: SecurityConfig;
    enableLogs: boolean;
}
export declare const config: Config;
export {};
