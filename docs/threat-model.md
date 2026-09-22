# NAVGuard threat model and integration checklist

NAVGuard protects settlement code that prices Token-2022 tokenized equities.
It is deliberately split into a read-only scanner and a CPI-enforced program.

## What is trusted

1. The Token-2022 mint account returned by the configured Solana RPC.
2. The Solana Clock sysvar returned by that RPC at the same confirmed
   commitment used for the mint account read.
3. The caller's own settlement math, which NAVGuard checks by receiving the
   multiplier the caller is about to use.

The xStocks registry and Pyth are evidence/discovery sources. They are not
authorities for multiplier activation or mint safety. A registry outage falls
back to audited mint addresses; a missing Pyth key leaves the parity panel
unavailable and does not make a token safe.

## Threats covered

| Threat | Detection or control | Residual risk |
| --- | --- | --- |
| A vault reads the stored Scaled UI multiplier after a replacement activates | Clock-aware scanner and `assert_safe_nav` CPI compare the caller's multiplier with the effective value | The vault must actually invoke the CPI guard on every sensitive path |
| A caller supplies an overly permissive deviation threshold | The on-chain program caps the threshold at 100 bps | A 100 bps policy may still be too loose for a particular product |
| Mint transfers are paused | Pausable extension is surfaced as red | The scanner is informational until a protocol uses the CPI path |
| Registry metadata is stale or unavailable | Live registry is discovery-only and has an audited fallback; mint bytes remain source of truth | New assets may not appear until the registry is reachable |
| Underlying/tokenized prices diverge or Pyth data is stale | Optional Pyth parity panel flags `DRIFT` above 100 bps and `STALE` after 120 seconds | Pyth is an observation signal, not a redemption guarantee |
| RPC proxy is abused as an open relay | Method allowlist, POST-only handling, body limit, and upstream timeout | Provider rate limits and availability still apply |

## CPI integration

Before paying out, pass the exact multiplier used in the settlement formula:

```rust
navguard::cpi::assert_safe_nav(
    CpiContext::new(navguard_program, navguard::cpi::accounts::Evaluate {
        navguard_program: navguard_program_info,
    }),
    mint,
    multiplier_used_by_vault,
    max_deviation_bps,
)?;
```

The guard fails closed on a missing Scaled UI Amount extension, a paused mint,
an invalid threshold, or a mismatch outside the configured policy. Keep the
guard in the same transaction as the transfer/redemption so a failed check
rolls back the payout.

## Deployment checklist

- Set `SOLANA_RPC_URL` to a dedicated provider endpoint.
- Set `PYTH_API_KEY` if the parity panel is part of the demo or operator flow.
- Deploy the Vercel edge functions in `api/rpc.ts`, `api/xstocks.ts`, and
  `api/pyth.ts` together with the frontend.
- Run `npm test`, `npm run typecheck`, `npm run build`, and
  `cargo test --workspace` in CI.
- Verify a guarded mismatch transaction reverts and that balances are
  unchanged; keep the explorer links in the submission materials.
