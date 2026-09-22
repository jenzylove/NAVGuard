import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  ExternalLink,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  ShieldX,
  TerminalSquare,
  Unplug,
  X,
} from "lucide-react";
import HeroArt from "./HeroArt";
import { ProofSection, IntegrateSection } from "./Sections";
import { RPC_URL, scanAssets, scanCustomMint } from "./lib/scanner";
import type { GuardState, MintScan } from "./lib/types";
import { fetchPriorityAssets } from "./lib/xstocks";
import { fetchPythParity, type PythParity } from "./lib/pyth";

const STATUS_LABEL: Record<GuardState, string> = {
  GREEN: "SAFE",
  AMBER: "REVIEW",
  RED: "BLOCK",
  UNKNOWN: "UNKNOWN",
};

function compactAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function formatMultiplier(value: number | null) {
  if (value === null) return "·";
  return value.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

function formatDelta(value: number | null) {
  if (value === null) return "·";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} bps`;
}

function formatTime(timestamp: number | null) {
  if (!timestamp) return "No transition scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp * 1000);
}

function stateIcon(state: GuardState) {
  if (state === "GREEN") return <Check size={13} strokeWidth={3} />;
  if (state === "RED") return <ShieldX size={13} strokeWidth={2.5} />;
  if (state === "AMBER") return <AlertTriangle size={13} strokeWidth={2.5} />;
  return <CircleHelp size={13} strokeWidth={2.5} />;
}

function SourceDot({ active = true }: { active?: boolean }) {
  return <span className={`source-dot ${active ? "source-dot--active" : ""}`} />;
}

function AssetMark({ scan }: { scan: MintScan }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (scan.logoUrl && !imageFailed) {
    return <img className="asset-mark" src={scan.logoUrl} alt="" onError={() => setImageFailed(true)} />;
  }
  return <span className="asset-mark asset-mark--fallback">{scan.symbol.slice(0, 1)}</span>;
}

function ScanRow({ scan, onSelect }: { scan: MintScan; onSelect: (scan: MintScan) => void }) {
  return (
    <button className="scan-row" type="button" onClick={() => onSelect(scan)}>
      <span className="asset-cell">
        <AssetMark scan={scan} />
        <span>
          <strong>{scan.symbol}</strong>
          <small>{scan.name}</small>
        </span>
      </span>
      <span className="mono mint-cell">{compactAddress(scan.mint)}</span>
      <span className="mono numeric-cell">{formatMultiplier(scan.rawMultiplier)}</span>
      <span className="mono numeric-cell effective-value">{formatMultiplier(scan.effectiveMultiplier)}</span>
      <span className={`mono numeric-cell ${scan.deltaBps ? "delta-value" : ""}`}>{formatDelta(scan.deltaBps)}</span>
      <span className={`status-pill status-pill--${scan.state.toLowerCase()}`} title={scan.reason}>
        {stateIcon(scan.state)} {STATUS_LABEL[scan.state]}
      </span>
      <ChevronRight className="row-chevron" size={17} />
    </button>
  );
}

function DetailPanel({ scan, onClose }: { scan: MintScan; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [pyth, setPyth] = useState<PythParity | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    const controller = new AbortController();
    void fetchPythParity(scan.symbol, scan.underlyingSymbol, controller.signal).then(setPyth).catch(() => {
      if (!controller.signal.aborted) setPyth({ status: "UNAVAILABLE", reason: "Pyth cross-check unavailable" });
    });
    return () => {
      controller.abort();
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [onClose, scan.symbol, scan.underlyingSymbol]);

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeButtonRef} className="icon-button close-button" type="button" onClick={onClose} aria-label="Close details">
          <X size={18} />
        </button>
        <div className="detail-header">
          <AssetMark scan={scan} />
          <div>
            <span className="eyebrow">MINT INSPECTION</span>
            <h2 id="detail-title">{scan.symbol}</h2>
            <p>{scan.name}</p>
          </div>
        </div>

        <div className={`verdict verdict--${scan.state.toLowerCase()}`}>
          <span className="verdict-icon">{stateIcon(scan.state)}</span>
          <span>
            <strong>{STATUS_LABEL[scan.state]}</strong>
            <small>{scan.reason}</small>
          </span>
        </div>

        <div className={`safety-summary safety-summary--${scan.safetyState.toLowerCase()}`}>
          <span>Mint safety</span>
          <strong>{STATUS_LABEL[scan.safetyState]}</strong>
          <small>{scan.safetyReason}</small>
        </div>

        <section className="detail-section">
          <div className="section-heading">
            <h3>Multiplier state</h3>
            <span>Token-2022</span>
          </div>
          <dl className="detail-grid">
            <div><dt>Stored field</dt><dd className="mono">{formatMultiplier(scan.rawMultiplier)}</dd></div>
            <div><dt>Effective now</dt><dd className="mono accent-text">{formatMultiplier(scan.effectiveMultiplier)}</dd></div>
            <div><dt>Replacement</dt><dd className="mono">{formatMultiplier(scan.pendingMultiplier)}</dd></div>
            <div><dt>NAV delta</dt><dd className="mono">{formatDelta(scan.deltaBps)}</dd></div>
          </dl>
          <div className="timestamp-row">
            <Clock3 size={15} />
            <span>Activation</span>
            <strong>{formatTime(scan.effectiveTimestamp)}</strong>
          </div>
          <div className="timestamp-row">
            <Clock3 size={15} />
            <span>Solana clock</span>
            <strong>{formatTime(scan.clockTimestamp)}</strong>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-heading"><h3>Pyth parity cross-check</h3><span>OPTIONAL ORACLE</span></div>
          {!pyth ? <div className="pyth-state">Checking the underlying equity against the tokenized feed…</div> : pyth.status === "UNAVAILABLE" ? (
            <div className="pyth-state">{pyth.reason ?? "Configure PYTH_API_KEY to enable this cross-check."}</div>
          ) : (
            <dl className="pyth-grid">
              <div><dt>Underlying</dt><dd className="mono">${pyth.underlyingPrice?.toFixed(4)}</dd></div>
              <div><dt>{pyth.feedKind === "REDEMPTION_RATE" ? "Tokenized (derived)" : "Tokenized"}</dt><dd className="mono">${pyth.tokenizedPrice?.toFixed(4)}</dd></div>
              <div><dt>Parity drift</dt><dd className="mono">{formatDelta(pyth.parityBps ?? null)}</dd></div>
              <div><dt>Status</dt><dd className={`pyth-status pyth-status--${pyth.status.toLowerCase()}`}>{pyth.status}</dd></div>
            </dl>
          )}
        </section>

        <section className="detail-section">
          <div className="section-heading"><h3>Transfer controls</h3></div>
          <div className="control-row">
            <span><LockKeyhole size={16} /> Pausable config</span>
            <strong>{scan.hasPausableConfig ? (scan.isPaused ? "PAUSED" : "ACTIVE") : "NOT FOUND"}</strong>
          </div>
          <div className="control-row">
            <span><Unplug size={16} /> Transfer hook</span>
            <strong>{scan.hasTransferHook ? "PRESENT" : "NOT FOUND"}</strong>
          </div>
        </section>

        {scan.error ? <div className="error-note">Decode error: {scan.error}</div> : null}

        <div className="detail-actions">
          <a className="primary-link" href={`https://solscan.io/token/${scan.mint}`} target="_blank" rel="noreferrer">
            Verify on Solscan <ExternalLink size={15} />
          </a>
          <button className="copy-button" type="button" onClick={() => navigator.clipboard.writeText(scan.mint)}>
            Copy mint
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  const [scans, setScans] = useState<MintScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selected, setSelected] = useState<MintScan | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GuardState | "ALL">("ALL");
  const [customMint, setCustomMint] = useState("");
  const [customLoading, setCustomLoading] = useState(false);
  const closeSelected = useCallback(() => setSelected(null), []);

  const runScan = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const assets = await fetchPriorityAssets(signal);
      const nextScans = await scanAssets(assets, signal);
      setScans(nextScans);
      setLastUpdated(new Date());
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "The live scan failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void runScan(controller.signal);
    return () => controller.abort();
  }, [runScan]);

  const metrics = useMemo(() => {
    const activated = scans.filter((scan) => scan.deltaBps !== null && Math.abs(scan.deltaBps) > 0.001);
    const maxDelta = activated.reduce<MintScan | null>((current, scan) => {
      if (!current) return scan;
      return Math.abs(scan.deltaBps ?? 0) > Math.abs(current.deltaBps ?? 0) ? scan : current;
    }, null);
    return {
      scanned: scans.length,
      review: scans.filter((scan) => scan.state === "AMBER").length,
      blocked: scans.filter((scan) => scan.state === "RED").length,
      maxDelta,
    };
  }, [scans]);

  const filteredScans = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scans.filter((scan) => {
      const matchesQuery = !normalized ||
        scan.symbol.toLowerCase().includes(normalized) ||
        scan.name.toLowerCase().includes(normalized) ||
        scan.mint.toLowerCase().includes(normalized);
      return matchesQuery && (filter === "ALL" || scan.state === filter);
    });
  }, [filter, query, scans]);

  async function submitCustomMint(event: FormEvent) {
    event.preventDefault();
    const candidate = customMint.trim();
    if (!candidate) return;
    setCustomLoading(true);
    setError(null);
    try {
      const scan = await scanCustomMint(candidate);
      setSelected(scan);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Custom mint scan failed.");
    } finally {
      setCustomLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="NAVGuard home">
          <span className="brand-mark"><ShieldCheck size={17} /></span>
          <span>navguard</span>
        </a>
        <nav>
          <a className="nav-link" href="#scan">Live scan</a>
          <a className="nav-link" href="#proof">Devnet proof</a>
          <a className="nav-link" href="#integrate">Integrate</a>
        </nav>
        <div className="topbar-right">
          <a className="nav-link" href="https://github.com/jenzylove/NAVGuard" target="_blank" rel="noreferrer">GitHub</a>
          <a className="cta-chip" href="#scan">Run the scan</a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>Stop pricing stocks with yesterday&rsquo;s multiplier</h1>
            <p>
              A Solana guard program that blocks vault mints, redemptions and loans priced on a stale
              Token-2022 multiplier.
            </p>
            <div className="hero-live">
              <SourceDot />
              {loading
                ? "Reading xStock mints on mainnet"
                : `${metrics.review + metrics.blocked} of ${metrics.scanned} live xStocks carry a stale multiplier right now`}
            </div>
          </div>
          <HeroArt />
        </section>

        <section className="metric-strip" aria-label="Scan overview">
          <div><small>MINTS SCANNED</small><strong>{loading ? "·" : metrics.scanned}</strong><span>priority xStocks</span></div>
          <div><small>ADAPTER REVIEW</small><strong className="amber-text">{loading ? "·" : metrics.review}</strong><span>stored-field risk</span></div>
          <div><small>HARD BLOCKS</small><strong className={metrics.blocked ? "red-text" : ""}>{loading ? "·" : metrics.blocked}</strong><span>paused or unsafe</span></div>
          <div><small>DATA PROVENANCE</small><strong className="source-name">ON-CHAIN</strong><span>not an indexer estimate</span></div>
        </section>

        <section className="scanner-section" id="scan">
          <div className="section-intro">
            <div>
              <span className="eyebrow">NAVGUARD SCAN</span>
              <h2>Inspect the live mint state.</h2>
              <p>Mint bytes and the Solana Clock sysvar are read at scan time. Review means a stored-field adapter is unsafe.</p>
            </div>
            <button className="refresh-button" type="button" onClick={() => void runScan()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh mainnet
            </button>
          </div>

          <div className="scanner-card">
            <div className="scanner-toolbar">
              <label className="search-box">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, company, or mint" />
              </label>
              <div className="filters" role="group" aria-label="Filter by adapter risk">
                {(["ALL", "AMBER", "GREEN", "RED"] as const).map((state) => (
                  <button className={filter === state ? "active" : ""} type="button" key={state} onClick={() => setFilter(state)}>
                    {state === "ALL" ? "All" : STATUS_LABEL[state]}
                  </button>
                ))}
              </div>
            </div>

            <div className="scan-table">
              <div className="table-head">
                <span>ASSET</span><span>MINT</span><span>STORED</span><span>EFFECTIVE NOW</span><span>DELTA</span><span>ADAPTER RISK</span><span />
              </div>
              {loading ? (
                <div className="loading-state"><LoaderCircle className="spin" size={25} /><strong>Reading mainnet mint accounts</strong><span>Decoding Token-2022 extensions…</span></div>
              ) : error && scans.length === 0 ? (
                <div className="error-state"><ShieldX size={25} /><strong>Live scan unavailable</strong><span>{error}</span><button type="button" onClick={() => void runScan()}>Try again</button></div>
              ) : filteredScans.length ? (
                filteredScans.map((scan) => <ScanRow key={scan.mint} scan={scan} onSelect={setSelected} />)
              ) : (
                <div className="empty-state">No mints match this filter.</div>
              )}
            </div>
            <div className="table-footer">
              <span><Database size={14} /> xStocks registry + Solana RPC</span>
              <span>{RPC_URL.endsWith("/api/rpc") ? "Same-origin mainnet gateway" : "Custom RPC endpoint"}</span>
            </div>
          </div>

          {error && scans.length > 0 ? <div className="inline-warning" role="alert"><AlertTriangle size={15} /> {error}</div> : null}

          <form className="custom-scan" onSubmit={(event) => void submitCustomMint(event)}>
            <div className="custom-icon"><Fingerprint size={22} /></div>
            <div className="custom-copy"><strong>Scan any Token-2022 mint</strong><span>Paste a mint address to inspect its extensions directly.</span></div>
            <label><input value={customMint} onChange={(event) => setCustomMint(event.target.value)} placeholder="Mint address" aria-label="Custom mint address" /></label>
            <button type="submit" disabled={customLoading || !customMint.trim()}>{customLoading ? <LoaderCircle className="spin" size={16} /> : <TerminalSquare size={16} />} Inspect</button>
          </form>
        </section>

        <section className="explanation-section" id="how-it-works">
          <div className="section-intro explanation-heading">
            <div><span className="eyebrow">THE BUG CLASS</span><h2>One timestamp. Two answers.</h2></div>
            <p>Token-2022 keeps the old and replacement multiplier in the same mint. The clock decides which is valid.</p>
          </div>
          <div className="explanation-grid">
            <article>
              <span className="step-number">01</span>
              <div className="article-icon article-icon--muted"><Database size={20} /></div>
              <h3>Naive read</h3>
              <p>An integration reads <code>multiplier</code> and calculates NAV. After activation, that field can be stale.</p>
              <div className="code-line"><span>value</span> = balance × <b>multiplier</b></div>
            </article>
            <article className="article-highlight">
              <span className="step-number">02</span>
              <div className="article-icon"><Clock3 size={20} /></div>
              <h3>Clock-aware read</h3>
              <p>NAVGuard compares the effective timestamp with Solana's clock before selecting the multiplier.</p>
              <div className="code-line"><span>effective</span> = now ≥ timestamp ? <b>new</b> : current</div>
            </article>
            <article>
              <span className="step-number">03</span>
              <div className="article-icon article-icon--green"><ShieldCheck size={20} /></div>
              <h3>Enforce, don't alert</h3>
              <p>The on-chain instruction returns typed GREEN, AMBER, or RED state for a vault to gate settlement.</p>
              <div className="code-line"><span>assert</span>(guard == <b>GREEN</b>)</div>
            </article>
          </div>
        </section>
        <ProofSection />
        <IntegrateSection />
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark"><ShieldCheck size={15} /></span><span>navguard</span></div>
        <p>Open safety infrastructure for tokenized stock integrations on Solana.</p>
        <span>Built for Stocklana 2026</span>
      </footer>

      {selected ? <DetailPanel scan={selected} onClose={closeSelected} /> : null}
    </div>
  );
}
