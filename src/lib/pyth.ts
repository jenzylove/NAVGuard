export type PythParity = {
  status: "MATCH" | "DRIFT" | "STALE" | "UNAVAILABLE";
  underlyingPrice?: number;
  tokenizedPrice?: number;
  parityBps?: number;
  publishTime?: number;
  feedKind?: "USD" | "REDEMPTION_RATE";
  reason?: string;
  feedSymbols?: Array<string | undefined>;
};

export async function fetchPythParity(symbol: string, underlyingSymbol?: string, signal?: AbortSignal): Promise<PythParity> {
  const token = symbol.replace(/x$/i, "").toUpperCase();
  const underlying = (underlyingSymbol ?? token).replace(/x$/i, "").toUpperCase();
  const response = await fetch(`/api/pyth?symbol=${encodeURIComponent(token)}&underlying=${encodeURIComponent(underlying)}`, { signal });
  const payload = (await response.json()) as PythParity;
  if (!response.ok && payload.status !== "UNAVAILABLE") throw new Error(payload.reason ?? "Pyth parity check failed");
  return payload;
}
