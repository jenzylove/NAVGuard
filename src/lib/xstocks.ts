import type { XStocksAsset } from "./types";

const API_ROOT = "https://api.xstocks.fi/api/v2/public";

// Verified against the official xStocks registry on 2026-09-21. Keeping this
// priority set local makes the scanner independent of the registry's browser
// CORS policy; Solana remains the live source of truth for every decoded field.
export const PRIORITY_ASSETS: XStocksAsset[] = [
  { symbol: "SPYx", name: "S&P 500 xStock", deployments: [{ network: "Solana", address: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" }] },
  { symbol: "NVDAx", name: "NVIDIA xStock", deployments: [{ network: "Solana", address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" }] },
  { symbol: "QQQx", name: "Nasdaq xStock", deployments: [{ network: "Solana", address: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" }] },
  { symbol: "METAx", name: "Meta xStock", deployments: [{ network: "Solana", address: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" }] },
  { symbol: "GOOGLx", name: "Alphabet xStock", deployments: [{ network: "Solana", address: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" }] },
  { symbol: "AAPLx", name: "Apple xStock", deployments: [{ network: "Solana", address: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" }] },
  { symbol: "TSLAx", name: "Tesla xStock", deployments: [{ network: "Solana", address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" }] },
  { symbol: "AMZNx", name: "Amazon.com xStock", deployments: [{ network: "Solana", address: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" }] },
  { symbol: "MSFTx", name: "Microsoft xStock", deployments: [{ network: "Solana", address: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" }] },
  { symbol: "COINx", name: "Coinbase xStock", deployments: [{ network: "Solana", address: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" }] },
];

interface ApiDeployment {
  address?: string;
  network?: string;
  chainId?: string;
}

interface ApiAsset {
  symbol?: string;
  name?: string;
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
  const response = await fetch(`${API_ROOT}/assets/${encodeURIComponent(symbol)}`, { signal });
  if (!response.ok) throw new Error(`xStocks registry returned ${response.status} for ${symbol}`);
  return normalizeAsset((await response.json()) as ApiAsset);
}

export async function fetchPriorityAssets(signal?: AbortSignal): Promise<XStocksAsset[]> {
  if (signal?.aborted) throw new DOMException("Scan cancelled", "AbortError");
  return PRIORITY_ASSETS;
}

export function getSolanaMint(asset: XStocksAsset): string | null {
  return asset.deployments.find((deployment) => deployment.network.toLowerCase() === "solana")?.address ?? null;
}
