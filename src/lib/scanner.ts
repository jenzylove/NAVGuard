import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getPausableConfig,
  getScaledUiAmountConfig,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";
import type { GuardState, MintScan, XStocksAsset } from "./types";
import { getSolanaMint } from "./xstocks";

const ACTIVATION_WINDOW_SECONDS = 15 * 60;

export const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL ??
  (typeof window === "undefined"
    ? "http://127.0.0.1:5173/api/rpc"
    : new URL("/api/rpc", window.location.origin).toString());

function asNumber(value: number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export function selectEffectiveMultiplier(
  current: number,
  replacement: number,
  replacementTimestamp: number,
  nowSeconds: number,
): number {
  return nowSeconds >= replacementTimestamp ? replacement : current;
}

export function classifyGuardState(input: {
  rawMultiplier: number | null;
  effectiveMultiplier: number | null;
  effectiveTimestamp: number | null;
  isPaused: boolean | null;
  nowSeconds: number;
}): { state: GuardState; reason: string } {
  if (input.isPaused) return { state: "RED", reason: "Transfers are paused on the mint" };
  if (input.rawMultiplier === null || input.effectiveMultiplier === null) {
    return { state: "UNKNOWN", reason: "Scaled UI Amount extension not found" };
  }

  const secondsFromActivation = input.effectiveTimestamp
    ? Math.abs(input.nowSeconds - input.effectiveTimestamp)
    : Number.POSITIVE_INFINITY;

  if (secondsFromActivation <= ACTIVATION_WINDOW_SECONDS) {
    return { state: "AMBER", reason: "Inside the multiplier activation safety window" };
  }

  if (Math.abs(input.effectiveMultiplier - input.rawMultiplier) > Number.EPSILON) {
    return { state: "AMBER", reason: "Naive integrations reading the stored field will use stale NAV math" };
  }

  return { state: "GREEN", reason: "Current Token-2022 state is internally consistent" };
}

function failedScan(asset: XStocksAsset, mint: string, message: string): MintScan {
  return {
    symbol: asset.symbol,
    name: asset.name,
    logoUrl: asset.logoUrl,
    mint,
    rawMultiplier: null,
    effectiveMultiplier: null,
    pendingMultiplier: null,
    effectiveTimestamp: null,
    deltaBps: null,
    state: "UNKNOWN",
    reason: "Mint could not be decoded",
    hasPausableConfig: false,
    isPaused: null,
    hasTransferHook: false,
    scannedAt: Date.now(),
    error: message,
  };
}

export async function scanAssets(assets: XStocksAsset[], signal?: AbortSignal): Promise<MintScan[]> {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");

  const connection = new Connection(RPC_URL, "confirmed");
  const scanTargets = assets
    .map((asset) => ({ asset, mint: getSolanaMint(asset) }))
    .filter((target): target is { asset: XStocksAsset; mint: string } => Boolean(target.mint));
  const publicKeys = scanTargets.map(({ mint }) => new PublicKey(mint));
  const accounts = await connection.getMultipleAccountsInfo(publicKeys, { commitment: "confirmed" });
  const nowSeconds = Math.floor(Date.now() / 1000);

  return scanTargets.map(({ asset, mint }, index) => {
    try {
      const account = accounts[index];
      if (!account) return failedScan(asset, mint, "Mint account does not exist");

      const mintState = unpackMint(publicKeys[index], account, TOKEN_2022_PROGRAM_ID);
      const scaled = getScaledUiAmountConfig(mintState);
      const pausable = getPausableConfig(mintState);
      const transferHook = getTransferHook(mintState);

      const rawMultiplier = scaled?.multiplier ?? null;
      const pendingMultiplier = scaled?.newMultiplier ?? null;
      const effectiveTimestamp = asNumber(scaled?.newMultiplierEffectiveTimestamp);
      const effectiveMultiplier =
        rawMultiplier !== null && pendingMultiplier !== null && effectiveTimestamp !== null
          ? selectEffectiveMultiplier(rawMultiplier, pendingMultiplier, effectiveTimestamp, nowSeconds)
          : rawMultiplier;
      const deltaBps =
        rawMultiplier && effectiveMultiplier !== null
          ? ((effectiveMultiplier / rawMultiplier) - 1) * 10_000
          : null;
      const isPaused = pausable?.paused ?? null;
      const classification = classifyGuardState({
        rawMultiplier,
        effectiveMultiplier,
        effectiveTimestamp,
        isPaused,
        nowSeconds,
      });

      return {
        symbol: asset.symbol,
        name: asset.name,
        logoUrl: asset.logoUrl,
        mint,
        rawMultiplier,
        effectiveMultiplier,
        pendingMultiplier,
        effectiveTimestamp,
        deltaBps,
        state: classification.state,
        reason: classification.reason,
        hasPausableConfig: Boolean(pausable),
        isPaused,
        hasTransferHook: Boolean(transferHook),
        scannedAt: Date.now(),
      };
    } catch (error) {
      return failedScan(asset, mint, error instanceof Error ? error.message : "Unknown decode error");
    }
  });
}

export async function scanCustomMint(mintAddress: string): Promise<MintScan> {
  const asset: XStocksAsset = {
    symbol: "CUSTOM",
    name: "Custom Token-2022 mint",
    deployments: [{ network: "Solana", address: mintAddress }],
  };
  const [scan] = await scanAssets([asset]);
  return scan;
}
