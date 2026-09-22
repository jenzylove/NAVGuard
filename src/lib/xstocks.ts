import type { XStocksAsset } from "./types";

const API_ROOT = typeof window === "undefined"
  ? "https://api.xstocks.fi/api/v2/public"
  : "/api/xstocks";

// Fallback set used only when the registry is temporarily unavailable. Solana
// remains the live source of truth for every decoded field.
export const PRIORITY_ASSETS: XStocksAsset[] = [
  { symbol: "SPYx", underlyingSymbol: "SPY", name: "S&P 500 xStock", deployments: [{ network: "Solana", address: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" }] },
  { symbol: "NVDAx", underlyingSymbol: "NVDA", name: "NVIDIA xStock", deployments: [{ network: "Solana", address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" }] },
  { symbol: "QQQx", underlyingSymbol: "QQQ", name: "Nasdaq xStock", deployments: [{ network: "Solana", address: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" }] },
  { symbol: "METAx", underlyingSymbol: "META", name: "Meta xStock", deployments: [{ network: "Solana", address: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" }] },
  { symbol: "GOOGLx", underlyingSymbol: "GOOGL", name: "Alphabet xStock", deployments: [{ network: "Solana", address: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" }] },
  { symbol: "AAPLx", underlyingSymbol: "AAPL", name: "Apple xStock", deployments: [{ network: "Solana", address: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" }] },
  { symbol: "TSLAx", underlyingSymbol: "TSLA", name: "Tesla xStock", deployments: [{ network: "Solana", address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" }] },
  { symbol: "AMZNx", underlyingSymbol: "AMZN", name: "Amazon.com xStock", deployments: [{ network: "Solana", address: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" }] },
  { symbol: "MSFTx", underlyingSymbol: "MSFT", name: "Microsoft xStock", deployments: [{ network: "Solana", address: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" }] },
  { symbol: "COINx", underlyingSymbol: "COIN", name: "Coinbase xStock", deployments: [{ network: "Solana", address: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" }] },
];

interface ApiDeployment {
  address?: string;
  network?: string;
  chainId?: string;
}

interface ApiAsset {
  symbol?: string;
  name?: string;
  underlyingSymbol?: string;
  logoUrl?: string;
  logo?: string;
  isTradingHalted?: boolean;
  deployments?: ApiDeployment[];
}

function normalizeAsset(asset: ApiAsset): XStocksAsset {
  if (!asset.symbol) throw new Error("xStocks registry returned an asset without a symbol");

  return {
    symbol: asset.symbol,
    name: asset.name ?? asset.symbol,
    underlyingSymbol: asset.underlyingSymbol ?? asset.symbol.replace(/x$/i, ""),
    logoUrl: asset.logoUrl ?? asset.logo,
    isTradingHalted: asset.isTradingHalted,
    deployments: (asset.deployments ?? [])
      .filter((deployment): deployment is Required<Pick<ApiDeployment, "address" | "network">> & ApiDeployment =>
        Boolean(deployment.address && deployment.network),
      )
      .map((deployment) => ({
        address: deployment.address,
        network: deployment.network,
        chainId: deployment.chainId,
      })),
  };
}

export async function fetchAsset(symbol: string, signal?: AbortSignal): Promise<XStocksAsset> {
  const url = typeof window === "undefined"
    ? `${API_ROOT}/assets/${encodeURIComponent(symbol)}`
    : `${API_ROOT}?symbol=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`xStocks registry returned ${response.status} for ${symbol}`);
  return normalizeAsset((await response.json()) as ApiAsset);
}

export async function fetchPriorityAssets(signal?: AbortSignal): Promise<XStocksAsset[]> {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
  try {
    const assets: XStocksAsset[] = [];
    for (let page = 0; page < 20; page += 1) {
      const pageUrl = typeof window === "undefined"
        ? `${API_ROOT}/assets?page=${page}`
        : `${API_ROOT}?page=${page}`;
      const response = await fetch(pageUrl, { signal });
      if (!response.ok) throw new Error(`xStocks registry returned ${response.status}`);
      const payload = (await response.json()) as { nodes?: ApiAsset[]; page?: { hasNextPage?: boolean } };
      for (const asset of payload.nodes ?? []) assets.push(normalizeAsset(asset));
      if (!payload.page?.hasNextPage) break;
    }
    const solanaAssets = assets.filter((asset) => Boolean(getSolanaMint(asset)));
    if (solanaAssets.length > 0) return solanaAssets;
    throw new Error("xStocks registry returned no Solana deployments");
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("xStocks registry unavailable; using the audited fallback set", error);
    return PRIORITY_ASSETS;
  }
}

export function getSolanaMint(asset: XStocksAsset): string | null {
  return asset.deployments.find((deployment) => deployment.network.toLowerCase() === "solana")?.address ?? null;
}
