interface FetchOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  
  private readonly failureThreshold = 5;
  private readonly successThreshold = 2;
  private readonly timeout = 60000;

  recordSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        console.log('[CIRCUIT] Closed - Service recovered');
      }
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.warn('[CIRCUIT] Opened - Service failing');
    }
  }

  canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }
    
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        console.log('[CIRCUIT] Half-open - Testing recovery');
        return true;
      }
      return false;
    }
    
    return true;
  }

  getState(): CircuitState {
    return this.state;
  }
}

class RequestQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private readonly maxConcurrent = 3;
  private activeRequests = 0;

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.activeRequests >= this.maxConcurrent) {
      return;
    }
    
    this.processing = true;
    
    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const fn = this.queue.shift();
      if (fn) {
        this.activeRequests++;
        fn().finally(() => {
          this.activeRequests--;
          this.process();
        });
      }
    }
    
    this.processing = false;
  }
}

const circuitBreaker = new CircuitBreaker();
const requestQueue = new RequestQueue();

function addJitter(delay: number): number {
  const jitter = Math.random() * 0.3 * delay;
  return delay + jitter;
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
    return parsed.toString();
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

export async function fetchWithRetry<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T | null> {
  const {
    timeout = 10000,
    retries = 3,
    retryDelay = 1000
  } = options;

  if (!circuitBreaker.canAttempt()) {
    console.warn('[FETCH] Circuit breaker OPEN, skipping request');
    return null;
  }

  const safeUrl = sanitizeUrl(url);

  return requestQueue.add(async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(safeUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'MemeScanner/3.0',
            'Accept': 'application/json'
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json() as T;
        
        circuitBreaker.recordSuccess();
        
        return data;

      } catch (error) {
        const isLastAttempt = attempt === retries;
        
        if (isLastAttempt) {
          console.error(`[FETCH] Failed after ${retries} attempts:`, safeUrl);
          circuitBreaker.recordFailure();
          return null;
        }

        const delay = addJitter(retryDelay * Math.pow(2, attempt - 1));
        console.warn(`[FETCH] Retry ${attempt}/${retries} in ${Math.floor(delay)}ms...`);
        await sleep(delay);
      }
    }

    return null;
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function getCircuitState(): string {
  return circuitBreaker.getState();
}
