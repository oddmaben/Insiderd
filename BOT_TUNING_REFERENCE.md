# Insiderd Bot Tuning Reference

Use this file as the "source of truth" when tuning your strategy in Claude.
It lists every meaningful filter and feature you can currently adjust in this repo.

## How To Use This With Claude

1. Paste this file into Claude.
2. Describe your goal (safe early entries, higher hit rate, lower false positives, etc.).
3. Ask Claude for a concrete config proposal:
   - aggressive
   - balanced
   - conservative
4. Apply the proposal by updating `.env` and/or the referenced code constants.

---

## 1) Environment Variables (No Code Change Needed)

Defined in `src/config.ts`.

| Variable | Default | Purpose | Where Used |
|---|---:|---|---|
| `TELEGRAM_BOT_TOKEN` | required | Main bot token for posting alerts | `src/config.ts`, `src/services/telegram.ts` |
| `TELEGRAM_CHANNEL_ID` | required | Channel/Chat destination for signals | `src/config.ts`, `src/services/telegram.ts` |
| `TELEGRAM_LOG_CHAT_ID` | `@DCKXE` | Telegram destination for forwarded logs | `src/config.ts`, `src/utils/logger.ts` |
| `ENABLE_TELEGRAM_LOG_FORWARDING` | `true` | Forward runtime logs to Telegram | `src/config.ts`, `src/utils/logger.ts` |
| `SEND_STARTUP_MESSAGE` | `false` unless explicitly set `true` | Sends startup status message | `src/config.ts`, `src/services/telegram.ts` |
| `ENABLE_LOGS` | `true` | Write log files under `logs/` | `src/config.ts`, `src/utils/logger.ts` |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | RPC endpoint (currently lightly used) | `src/config.ts`, `src/services/liquidityCheck.ts` |
| `POLL_INTERVAL` | `3000` | Scan interval in ms | `src/config.ts`, `src/index.ts` |
| `MAX_AGE` | `10` | Max pair age in minutes | `src/config.ts`, `src/services/scanner.ts` |
| `MIN_LIQUIDITY` | `300` | Min liquidity threshold | `src/config.ts`, `src/services/filter.ts` |
| `MIN_VOLUME` | `2000` | Min 5m volume threshold | `src/config.ts`, `src/services/filter.ts` |
| `MIN_MARKET_CAP` | `10000` | Min market cap threshold | `src/config.ts`, `src/services/filter.ts` |
| `MAX_MARKET_CAP` | `500000` | Max market cap threshold | `src/config.ts`, `src/services/filter.ts` |

---

## 2) Scanner Discovery Controls (Code Constants)

### Search Terms
- File: `src/services/scanner.ts`
- Constant: `SEARCH_TERMS`
- Effect: controls which DexScreener search keywords are queried.

Current terms include launchpad-focused keywords like:
`pumpfun`, `mayhem`, `bonk`, `moonshot`, `raydium`, `meteora`, `orca`, etc.

### Cache / Duplicate Handling
- File: `src/services/scanner.ts`
- Constants:
  - `CACHE_CLEANUP_INTERVAL = 3600000` (1 hour cleanup cadence)
  - `maxCacheAge = 24 * 60 * 60 * 1000` (24h seen-pair retention)
- Effect: prevents repeat alerts and controls memory/file churn.

---

## 3) Launchpad Allowlist Controls

- File: `src/services/liquidityCheck.ts`
- Constant: `ALLOWED_LAUNCHPADS`
- Effect: pair must match one of these normalized strings (via `dexId` or URL) or it is rejected.

Current allowlist includes:
Pumpfun, Mayhem, Bonk, Bonkers, Bags, Memoo, Liquid, Bankr, Zora, Surge, Anoncoin, Moonshot, Wen.dev, Heaven, Sugar, TokenMill, Believe, Trends, Trends.fun, Studio, Moonit, Boop, xStocks, Launchlab, Dynamic BC, Raydium, Meteora, Pump AMM, Orca.

---

## 4) Hard Filters (Pass/Fail)

Defined in `src/services/filter.ts`.

### Primary Gates
- `liquidity < MIN_LIQUIDITY` => reject
- `volume5m < MIN_VOLUME` => reject
- `marketCap < MIN_MARKET_CAP` => reject
- `marketCap > MAX_MARKET_CAP` => reject

### Additional Anti-Scam Gates (Hardcoded)
- `fdv / liquidity > 1000` => reject (`Suspicious FDV/Liquidity ratio`)
- `priceChange > 300` AND `volume5m < 1000` => reject (`Honeypot pattern`)

### Warning-Only Heuristics (Not Hard Reject)
- `priceChange > 200` => extreme pump warning
- `priceChange > 100` => high pump warning
- token age `< 2m` => warning
- liquidity `< 1000` => warning
- volume5m `< 200` => warning

---

## 5) RugCheck Security Controls

Defined in `src/services/rugcheck.ts`.

### Fail-Closed Behavior
- RugCheck `404` => reject (`Incomplete security data`)
- Any non-OK RugCheck status => reject
- API/network error => reject

### Risk Thresholds
- `score > 1500` => reject
- Any risk with `level === "danger"` => reject
- Any risk name matching `BLOCKED_RISK_PATTERNS` => reject

Current blocked pattern list includes:
- incomplete security data
- anti-whale
- blacklist
- balances modifiable
- honeypot detected
- honeypot trigger
- modifiable taxes
- hidden owner
- proxy contract
- suspicious function
- tax farmer
- unverified contract
- mutable contract
- transfer freeze / freezable
- mintable
- rug pull
- red flag

---

## 6) Multiplier Alert Controls

Defined in `src/services/multiplierTracker.ts`.

### Targets
- `TARGET_MULTIPLIERS = [1.5, 2, 2.5, 3, 5, 7, 9, 10, 12, 15, 20]`

### Tracking Window
- `MAX_TRACK_MINUTES = 6 * 60` (tracks up to 6 hours after first signal)
- `CHECK_INTERVAL_MS = 60_000` (checks every 60s)

### Market Cap Source
- Base MC = `pair.fdv` when available
- Fallback = `liquidity * 10`

---

## 7) Telegram Message / Branding Controls

Defined in `src/services/telegram.ts` and `src/services/multiplierTracker.ts`.

### Signal Template
- Main alert message text is built in `formatMessage(...)`.
- Current CTA footer:
  - `PM @DCKXE for Insider access.`

### Transport Behavior
- `MESSAGE_RATE_LIMIT = 1000` (1 message/sec pacing)
- `splitMessage(...)` max segment length = 4000 chars
- Retry logic in `sendWithRetry(...)` attempts up to 3 times.

---

## 8) Log Forwarding Controls

Defined in `src/utils/logger.ts`.

### Telegram Log Batching
- `TELEGRAM_SEND_INTERVAL_MS = 1200`
- `TELEGRAM_BATCH_SIZE = 6`
- `TELEGRAM_MAX_QUEUE = 400`

### Notes
- INFO/SUCCESS/WARN/ERROR/DEBUG all enqueue to Telegram when enabled.
- If log volume is high, messages are batched and rate-limited.

---

## 9) Runtime / Health Controls

Defined in `src/index.ts`.

- `setInterval(scanLoop, POLL_INTERVAL)`
- `setInterval(healthCheck, 300000)` (health every 5 min)
- graceful shutdown handlers for `SIGINT` and `SIGTERM`

---

## 10) Fast Tuning Playbook

### Conservative (safer, fewer calls)
- Increase `MIN_VOLUME`
- Increase `MIN_LIQUIDITY`
- Increase `MIN_MARKET_CAP`
- Reduce `MAX_MARKET_CAP`
- Keep RugCheck fail-closed as-is

### Aggressive (more calls, earlier)
- Lower `MIN_VOLUME`
- Lower `MIN_LIQUIDITY`
- Lower `MIN_MARKET_CAP`
- Increase `MAX_MARKET_CAP`
- Consider adding more search terms

### Suggested A/B Process
1. Tune one group at a time (liquidity/volume OR market cap OR risk list).
2. Run 24h and export outcomes.
3. Compare hit rate vs false positives.
4. Iterate in small steps.

---

## 11) Deploy Reminder (changes are not live until restart)

After changing `.env` or code:

```bash
npm run build
pm2 restart meme-scanner
pm2 logs meme-scanner
```

