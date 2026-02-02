# Token Trending Command Center

All in one platform to track and trend specific tokens. It combines live on-chain
liquidity, volume, and transaction data with community engagement inputs such as
holders, unique makers, DEX Screener visitors, and reactions.

## Features

- Live metrics from DexScreener (liquidity, volume, transactions, price).
- Community engagement inputs (holders, unique makers, visitors, reactions).
- Trend score with configurable weights.
- Watchlist and trending ranking for multiple tokens.
- Recommendations to boost volume, makers, and engagement.

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## How scoring works

The trend score is a weighted blend of:

- Liquidity
- 24h Volume
- 24h Transactions
- Unique makers (manual or derived from transactions)
- Holders
- Community engagement (visitors + reactions)

Weights are normalized automatically. You can update them with the API below.

## API endpoints

### Token snapshot

```
GET /api/token/:chain/:address
```

Returns token metrics, community data, trend score, and recommendations.

### Community metrics

```
GET /api/community/:chain/:address
POST /api/community/:chain/:address
```

POST body example:

```json
{
  "holders": 1200,
  "uniqueMakers": 450,
  "visitors24h": 3200,
  "reactions": { "bullish": 120, "neutral": 40, "bearish": 10 }
}
```

### Watchlist

```
GET /api/watchlist
POST /api/watchlist
DELETE /api/watchlist/:chain/:address
```

POST body example:

```json
{
  "chain": "ethereum",
  "address": "0x...",
  "label": "My token"
}
```

### Trending list

```
GET /api/trending
```

Returns scored tokens sorted by trend score.

### Score weights

```
GET /api/weights
PUT /api/weights
```

PUT body example:

```json
{
  "liquidity": 0.3,
  "volume": 0.25,
  "transactions": 0.2,
  "uniqueMakers": 0.1,
  "holders": 0.1,
  "engagement": 0.05
}
```

## Notes

- Requires Node.js 18+ for the native Fetch API.
- DexScreener does not provide holders or unique makers directly. Use the
  community panel to supply those numbers for higher accuracy.

