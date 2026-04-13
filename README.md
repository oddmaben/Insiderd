# Insiderd (Solana Signal Bot)

Insiderd is a Telegram signal bot for Solana meme coins.  
It scans DexScreener, filters by launchpad + risk policy + market rules, and posts formatted signals to your Telegram channel.  
It also tracks winners after alert and sends multiplier updates (1.5x, 2x, 2.5x, 3x, 5x, 7x, 9x, 10x, 12x, 15x, 20x).

## What This Bot Does

- Scans new Solana pairs from DexScreener using launchpad-focused search terms.
- Restricts alerts to an allowlist of launchpads.
- Applies strict RugCheck-based risk exclusions.
- Enforces trading thresholds (market cap and 5-minute volume).
- Sends a branded first alert to Telegram (`Insider Dinero` format).
- Starts post-alert multiplier tracking and sends follow-up x-multiple messages.
- Uses retries, rate limiting, caching, and auto-restart-friendly runtime behavior.

## Supported Launchpads / Venues

- Pumpfun
- Mayhem
- Bonk
- Bonkers
- Bags
- Memoo
- Liquid
- Bankr
- Zora
- Surge
- Anoncoin
- Moonshot
- Wen.dev
- Heaven
- Sugar
- TokenMill
- Believe
- Trends
- Trends.fun
- Studio
- Moonit
- Boop
- xStocks
- Launchlab
- Dynamic BC
- Raydium
- Meteora
- Pump AMM
- Orca

## Risk and Safety Filters

The bot rejects tokens when RugCheck is missing/unavailable or when any matched risk includes:

- incomplete security data
- anti-whale mechanism / modifiable anti-whale
- blacklist function
- balances modifiable
- honeypot detected
- honeypot trigger
- modifiable taxes
- hidden owner
- proxy contract
- misc red flags
- suspicious functions
- tax farmer risk
- unverified contract
- mutable contract
- transfers freezable
- mintable tokens
- rug pull risk

Additional hard rules:

- Market cap must be between `$10,000` and `$500,000`
- 5-minute volume must be `>= $2,000`
- Pair age must be within `MAX_AGE` window
- FDV/Liquidity scam ratio and honeypot-pattern checks are applied

## Telegram Message Flow

1. **Primary Signal** (formatted overview):
   - Brand header (`Insider Dinero`)
   - Name, contract, market cap, age, volume, bonding line
2. **Multiplier Follow-ups**:
   - Sent when token reaches each configured multiplier target
   - Format: `💸 $SYMBOL 1.5x | 2.1x with PRO ⚡️`

## Requirements

- Node.js 18+ (Node 20 recommended)
- npm
- Telegram bot token (BotFather)
- Telegram channel where the bot is admin

## Setup

1. Clone:

```bash
git clone https://github.com/oddmaben/Insiderd.git
cd Insiderd
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` in the project root:

```env
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_CHANNEL_ID=@CalledByDinero
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

POLL_INTERVAL=3000
MAX_AGE=10

MIN_LIQUIDITY=300
MIN_VOLUME=2000
MIN_MARKET_CAP=10000
MAX_MARKET_CAP=500000

SEND_STARTUP_MESSAGE=true
ENABLE_LOGS=true
```

## Run

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## 24/7 Process Management (PM2)

Start:

```bash
npm run build
npm run pm2:start
```

Logs:

```bash
npm run pm2:logs
```

Restart:

```bash
npm run pm2:restart
```

Stop:

```bash
npm run pm2:stop
```

To keep PM2 running across server reboots:

```bash
pm2 startup
pm2 save
```

## Security Notes

- Do not commit `.env` or bot tokens.
- If a token was ever shared publicly, rotate it immediately in BotFather.
- Keep bot admin permissions limited to what is needed to post in channel.

## Disclaimer

This software is for educational/research use.  
Crypto trading is highly risky and volatile. Always DYOR.

## License

MIT - see [LICENSE](LICENSE).
