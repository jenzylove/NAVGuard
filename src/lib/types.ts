export type GuardState = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

export interface XStocksDeployment {
  address: string;
  network: string;
  chainId?: string;
}

export interface XStocksAsset {
  symbol: string;
  name: string;
  underlyingSymbol?: string;
  logoUrl?: string;
  isTradingHalted?: boolean;
  deployments: XStocksDeployment[];
}

export interface MintScan {
  symbol: string;
  name: string;
  underlyingSymbol?: string;
  logoUrl?: string;
  mint: string;
  rawMultiplier: number | null;
  effectiveMultiplier: number | null;
  pendingMultiplier: number | null;
  effectiveTimestamp: number | null;
  deltaBps: number | null;
  state: GuardState;
  reason: string;
  safetyState: GuardState;
  safetyReason: string;
  clockTimestamp: number | null;
  hasPausableConfig: boolean;
  isPaused: boolean | null;
  hasTransferHook: boolean;
  scannedAt: number;
  error?: string;
}
