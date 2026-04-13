interface FetchOptions {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
}
export declare function fetchWithRetry<T>(url: string, options?: FetchOptions): Promise<T | null>;
export declare function sleep(ms: number): Promise<void>;
export declare function safeJsonParse<T>(text: string): T | null;
export declare function getCircuitState(): string;
export {};
