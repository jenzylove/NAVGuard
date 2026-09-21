# NAVGuard

Clock-aware NAV safety infrastructure for tokenized stocks on Solana.

Token-2022's Scaled UI Amount extension stores both a current multiplier and a
replacement multiplier with an activation timestamp. A naive integration can
continue reading the stored field after the replacement becomes effective,
which corrupts NAV, share pricing, collateral checks, or settlement math.

NAVGuard's first shipped surface is a wallet-free mainnet scanner that:

- decodes live Scaled UI Amount, Pausable, and Transfer Hook extensions;
- selects the multiplier that is effective according to the activation clock;
- quantifies the difference from a naive stored-field read;
- classifies each mint as `SAFE`, `REVIEW`, or `BLOCK`;
- provides per-mint evidence and a Solscan verification link.

The next program milestone exposes this policy as a CPI guard so vaults can
enforce it before settlement instead of merely receiving an alert.

## Run locally

```bash
npm install
npm run dev
```

The Vite development server proxies `/api/rpc` to a public Solana mainnet RPC.
For production, the included Vercel edge function performs the same gateway
role. Set `SOLANA_RPC_URL` to a dedicated provider endpoint before deployment.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Current architecture

```text
xStocks mint registry (pinned priority set)
                    │
                    ▼
          Solana mainnet RPC gateway
                    │
                    ▼
       Token-2022 extension decoder
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
  clock-aware multiplier   transfer controls
          │                   │
          └─────────┬─────────┘
                    ▼
             NAVGuard verdict
```

No wallet connection is required for the scanner. The evidence is public mint
state, not user portfolio data.
