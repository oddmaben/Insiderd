var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (CircuitState = {}));
class CircuitBreaker {
    state = CircuitState.CLOSED;
    failureCount = 0;
    successCount = 0;
    lastFailureTime = 0;
    failureThreshold = 5;
    successThreshold = 2;
    timeout = 60000;
    recordSuccess() {
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
    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.state = CircuitState.OPEN;
            console.warn('[CIRCUIT] Opened - Service failing');
        }
    }
    canAttempt() {
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
    getState() {
        return this.state;
    }
}
class RequestQueue {
    queue = [];
    processing = false;
    maxConcurrent = 3;
    activeRequests = 0;
    async add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await fn();
                    resolve(result);
                }
                catch (error) {
                    reject(error);
                }
            });
            this.process();
        });
    }
    async process() {
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
function addJitter(delay) {
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
}
function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
        return parsed.toString();
    }
    catch {
        throw new Error(`Invalid URL: ${url}`);
    }
}
export async function fetchWithRetry(url, options = {}) {
    const { timeout = 10000, retries = 3, retryDelay = 1000, skipCircuitBreaker = false } = options;
    if (!skipCircuitBreaker && !circuitBreaker.canAttempt()) {
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
                const data = await response.json();
                if (!skipCircuitBreaker) {
                    circuitBreaker.recordSuccess();
                }
                return data;
            }
            catch (error) {
                const isLastAttempt = attempt === retries;
                if (isLastAttempt) {
                    console.error(`[FETCH] Failed after ${retries} attempts:`, safeUrl);
                    if (!skipCircuitBreaker) {
                        circuitBreaker.recordFailure();
                    }
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
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
export function getCircuitState() {
    return circuitBreaker.getState();
}
//# sourceMappingURL=fetch.js.map