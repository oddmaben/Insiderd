# Meme Coin Scanner v1.0 (Solana)

A production-ready, high-performance bot that scans for new meme coins on Solana, applies safety filters, and sends alerts to Telegram.
<img width="480" height="862" alt="image" src="https://github.com/user-attachments/assets/9b65b981-2af9-4482-b603-71988495c21b" />


## Features

- **Automated Scanning**: Scans DexScreener for new Solana pairs based on keywords (pump, pepe, doge, moon, cat, inu, shib, solana, bonk, wif).
- **Advanced Filtering**:
  - **Liquidity**: Checks if liquidity is above a minimum threshold.
  - **Volume**: Checks if 5-minute volume is above a minimum threshold.
  - **Age**: Filters pairs by maximum age.
  - **FDV/Liquidity Ratio**: Detects potential scams with suspicious ratios.
  - **Honeypot Detection**: Identifies honeypot patterns (high pump with low volume).
- **Security Checks**:
  - **Liquidity Lock**: Checks if liquidity is locked (supports Pump.fun and Moonshot).
  - **RugCheck Integration**: Validates tokens against RugCheck.xyz API.
- **Telegram Alerts**: Sends detailed alerts with token info, trading stats, and risk warnings.
- **Resilience**:
  - **Rate Limiting**: Prevents spamming Telegram.
  - **Retry Logic**: Handles network failures gracefully.
  - **Caching**: Prevents duplicate alerts.
  - **Health Checks**: Monitors system status.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MbotixTech/meme-coins-signal.git
   cd meme-coins-signal
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   Copy `.env.example` to `.env` and fill in the required values.
   ```bash
   cp .env.example .env
   ```

## Configuration

Edit the `.env` file to configure the bot:

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot Token | Required |
| `TELEGRAM_CHANNEL_ID` | Your Telegram Channel ID | Required |
| `SOLANA_RPC_URL` | Solana RPC URL | https://api.mainnet-beta.solana.com |
| `POLL_INTERVAL` | Scanning interval in ms | 3000 |
| `MIN_LIQUIDITY` | Minimum liquidity in USD | 300 |
| `MIN_VOLUME` | Minimum 5m volume in USD | 50 |
| `MAX_AGE` | Maximum pair age in minutes | 10 |
| `ENABLE_LOGS` | Enable file logging | true |
| `SEND_STARTUP_MESSAGE` | Send a message on startup | true |

## Usage

Start the scanner:

```bash
npm start
```

For development:

```bash
npm run dev
```

## Disclaimer

This tool is for educational and research purposes only. Cryptocurrency investments, especially meme coins, are highly volatile and risky. Always Do Your Own Research (DYOR). The developers are not responsible for any financial losses.


## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
