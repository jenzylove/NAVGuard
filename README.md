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

## Live on devnet

| Program | Address |
| --- | --- |
| NAVGuard | [`GFmZc6zgoYHStU2gU6cZem4sDEtJhHhdGMRCRuXBb7KA`](https://explorer.solana.com/address/GFmZc6zgoYHStU2gU6cZem4sDEtJhHhdGMRCRuXBb7KA?cluster=devnet) |
| Reference vault | [`3mELb3aUhBEtWX3uQoCfLCs5M68Wn8YUTJwdkQZDYKZM`](https://explorer.solana.com/address/3mELb3aUhBEtWX3uQoCfLCs5M68Wn8YUTJwdkQZDYKZM?cluster=devnet) |

| Step | Result | Transaction |
| --- | --- | --- |
| `redeem_guarded` | Reverted on chain inside the NAVGuard CPI: `MultiplierMismatch` (6006). No funds moved. | [explorer](https://explorer.solana.com/tx/3W4FPythLyF1FCRNF8fFzJ176XKyD5o4Fo6t3HnWXfzEtWphUBo9TFLqqfJshugHjo6b6zZXxYwcokRw8Yw6bDWb?cluster=devnet) |
| `redeem_unguarded` | Paid 50 tokens where 25 were owed. | [explorer](https://explorer.solana.com/tx/5LTgXpP3wQdKomQ7aM8HryzjhHQWzQVVk8XU3aURFyqp5Vb13HMnWTiyuKeZgCigvHLN7T5ug2eqeG56KH87SVwm?cluster=devnet) |

Full run with every step: `docs/devnet-proof.json`.

## End to end on a live validator

Both programs compile to SBF and run the exploit against a real Token-2022 mint
with the Scaled UI Amount extension. `scripts/devnet-demo.mjs` creates the mint,
deposits two holders into the vault at multiplier 1.0, schedules a 2:1 corporate
action a few seconds ahead, and lets it activate. The stored multiplier stays at
1 while the effective one becomes 2, the same state as the live xStocks.

| Step | Result |
| --- | --- |
| `redeem_guarded` | Reverted inside the NAVGuard CPI: `MultiplierMismatch` (6006). No funds moved. |
| `redeem_unguarded` | Paid 50 tokens where 25 were owed. The extra 25 came from the other depositor. |

Recorded run: `docs/localnet-proof.json`.

```bash
# inside WSL / Linux
bash scripts/wsl-toolchain.sh   # Rust, Agave Solana CLI
bash scripts/wsl-build.sh       # SBF build, program ids synced to target/deploy
bash scripts/wsl-localnet.sh    # validator with both programs loaded
# from the repo root
SOLANA_RPC_URL=http://127.0.0.1:8899 node scripts/devnet-demo.mjs
```

Point `SOLANA_RPC_URL` at devnet after `solana program deploy` to produce explorer
links.

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
