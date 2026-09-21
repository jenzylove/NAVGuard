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

The program exposes this policy as a CPI guard, so vaults enforce it before
settlement instead of merely receiving an alert. A reference vault shows the
difference on the real SPYx mint.

## Reproduce the live bug class

```bash
npm run demo:live
```

The script reads the SPYx mint from mainnet and compares a reference vault that
uses the stored multiplier with clock-aware NAV math. It does not touch funds or
submit a transaction.

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
cargo check -p navguard
```

The on-chain workspace contains:

- `navguard-core`: a `no_std` deterministic policy engine;
- `programs/navguard`: Anchor instructions for read-only `evaluate` and
  CPI-enforced `assert_safe_nav`;
- `programs/reference-vault`: the vulnerable vault and its fix.

## Reference vault: the exploit and the fix

`programs/reference-vault` is a deliberately ordinary vault for tokenized
stocks. It prices shares with the stored `multiplier` field, the most common
integration mistake. Its two redeem instructions run identical math:

| Instruction | What happens |
| --- | --- |
| `redeem_unguarded` | Pays out with the stale multiplier. Every redeemer takes more raw tokens than they are owed, drained from the remaining depositors. |
| `redeem_guarded` | Calls `navguard::assert_safe_nav` through CPI with the exact multiplier it is about to use. NAVGuard rejects it with `MultiplierMismatch` and the whole transaction reverts. |

The fix is one CPI. The vault math does not change.

`programs/reference-vault/tests/spyx_exploit.rs` replays this against the SPYx
mint account captured from mainnet at slot 449128089 (`tests/fixtures/`):

- the stored multiplier trails the effective one by about 18 bps;
- redeeming 1,000 SPY of shares through the unguarded path overpays by roughly
  1.8 SPYx;
- NAVGuard returns `RED / MultiplierMismatch` for the vault's multiplier and
  `GREEN / Safe` for the effective one.

A 4:1 split produces the same bug at 7,500 bps, covered by the policy tests in
`navguard-core`.

```bash
cargo test --workspace
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
