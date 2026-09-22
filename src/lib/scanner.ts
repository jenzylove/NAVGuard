import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { Buffer } from "buffer";
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
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
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
  if (!Number.isFinite(input.rawMultiplier) || !Number.isFinite(input.effectiveMultiplier) || input.rawMultiplier <= 0 || input.effectiveMultiplier <= 0) {
    return { state: "RED", reason: "Scaled UI multiplier is invalid" };
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

export function classifyMintSafety(input: {
  effectiveTimestamp: number | null;
  effectiveMultiplier: number | null;
  isPaused: boolean | null;
  nowSeconds: number;
}): { state: GuardState; reason: string } {
  if (input.isPaused) return { state: "RED", reason: "Transfers are paused on the mint" };
  if (input.effectiveMultiplier === null) {
    return { state: "UNKNOWN", reason: "Scaled UI Amount extension not found" };
  }
  if (!Number.isFinite(input.effectiveMultiplier) || input.effectiveMultiplier <= 0) {
    return { state: "RED", reason: "Scaled UI multiplier is invalid" };
  }

  const secondsFromActivation = input.effectiveTimestamp
    ? Math.abs(input.nowSeconds - input.effectiveTimestamp)
    : Number.POSITIVE_INFINITY;
  if (secondsFromActivation <= ACTIVATION_WINDOW_SECONDS) {
    return { state: "AMBER", reason: "Inside the multiplier activation safety window" };
  }
  return { state: "GREEN", reason: "Mint is safe for the current clock" };
}

function decodeClockTimestamp(data: Buffer | Uint8Array | null): number | null {
  if (!data || data.length < 40) return null;
  const view = Buffer.from(data);
  const timestamp = Number(view.readBigInt64LE(32));
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function failedScan(asset: XStocksAsset, mint: string, message: string): MintScan {
  return {
    symbol: asset.symbol,
    name: asset.name,
    underlyingSymbol: asset.underlyingSymbol,
    logoUrl: asset.logoUrl,
    mint,
    rawMultiplier: null,
    effectiveMultiplier: null,
    pendingMultiplier: null,
    effectiveTimestamp: null,
    deltaBps: null,
    state: "UNKNOWN",
    reason: "Mint could not be decoded",
    safetyState: "UNKNOWN",
    safetyReason: "Mint could not be decoded",
    clockTimestamp: null,
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
  const [accounts, clockAccount] = await Promise.all([
    connection.getMultipleAccountsInfo(publicKeys, { commitment: "confirmed" }),
    connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
  ]);
  const clockTimestamp = decodeClockTimestamp(clockAccount?.data ?? null);
  if (clockTimestamp === null) throw new Error("Solana Clock sysvar could not be decoded");
  const nowSeconds = clockTimestamp;

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
      const safety = classifyMintSafety({
        effectiveTimestamp,
        effectiveMultiplier,
        isPaused,
        nowSeconds,
      });

      return {
        symbol: asset.symbol,
        name: asset.name,
        underlyingSymbol: asset.underlyingSymbol,
        logoUrl: asset.logoUrl,
        mint,
        rawMultiplier,
        effectiveMultiplier,
        pendingMultiplier,
        effectiveTimestamp,
        deltaBps,
        state: classification.state,
        reason: classification.reason,
        safetyState: safety.state,
        safetyReason: safety.reason,
        clockTimestamp,
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
