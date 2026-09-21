import { ArrowUpRight, ShieldCheck, ShieldX } from "lucide-react";
import proof from "../docs/devnet-proof.json";

type Step = { name: string; tx?: string; reason?: string; raw_paid?: string; raw_owed?: string; overpaid?: string };

const steps = proof.steps as Step[];
const guarded = steps.find((s) => s.name.startsWith("redeem_guarded"));
const unguarded = steps.find((s) => s.name === "redeem_unguarded");
const errorName = guarded?.reason?.match(/Error Code: (\w+)/)?.[1] ?? "MultiplierMismatch";
const address = (id: string) => `https://explorer.solana.com/address/${id}?cluster=devnet`;

export function ProofSection() {
  return (
    <section className="proof-section" id="proof">
      <div className="section-intro">
        <div>
          <span className="eyebrow">Devnet proof</span>
          <h2>Same vault. Same math. One CPI apart.</h2>
          <p>
            A 2:1 corporate action activates on a real Token-2022 mint. The stored multiplier stays at 1 while the
            effective one becomes 2. Then the same redemption runs twice.
          </p>
        </div>
      </div>

      <div className="proof-grid">
        <article className="proof-card proof-card--bad">
          <div className="proof-card-top">
            <span className="proof-icon"><ShieldX size={18} /></span>
            <code>redeem_unguarded</code>
          </div>
          <strong className="proof-figure">{unguarded?.raw_paid ?? "50 tokens"}</strong>
          <p>
            paid out where <b>{unguarded?.raw_owed ?? "25 tokens"}</b> were owed. The difference came from the other
            depositor.
          </p>
          {unguarded?.tx ? (
            <a className="proof-link" href={unguarded.tx} target="_blank" rel="noreferrer">
              View transaction <ArrowUpRight size={14} />
            </a>
          ) : null}
        </article>

        <article className="proof-card proof-card--good">
          <div className="proof-card-top">
            <span className="proof-icon"><ShieldCheck size={18} /></span>
            <code>redeem_guarded</code>
          </div>
          <strong className="proof-figure">Reverted</strong>
          <p>
            inside the NAVGuard CPI with <b>{errorName}</b>. The whole transaction rolled back and no funds moved.
          </p>
          {guarded?.tx ? (
            <a className="proof-link" href={guarded.tx} target="_blank" rel="noreferrer">
              View reverted transaction <ArrowUpRight size={14} />
            </a>
          ) : null}
        </article>
      </div>

      <div className="program-row">
        <a href={address(proof.navguard)} target="_blank" rel="noreferrer">
          <span>NAVGuard program</span>
          <code>{proof.navguard}</code>
        </a>
        <a href={address(proof.vault_program)} target="_blank" rel="noreferrer">
          <span>Reference vault</span>
          <code>{proof.vault_program}</code>
        </a>
      </div>
    </section>
  );
}

const SNIPPET = `// Before any NAV sensitive action, ask NAVGuard.
navguard::cpi::assert_safe_nav(
    CpiContext::new(
        ctx.accounts.navguard_program.key(),
        navguard::cpi::accounts::Evaluate {
            mint: ctx.accounts.mint.to_account_info(),
        },
    ),
    multiplier_e9,   // the multiplier your math is about to use
    5,               // max deviation in bps
)?;
// GREEN continues. AMBER or RED reverts the whole transaction.`;

export function IntegrateSection() {
  return (
    <section className="integrate-section" id="integrate">
      <div className="integrate-copy">
        <span className="eyebrow">Integrate</span>
        <h2>One call before you settle</h2>
        <p>
          Pass the multiplier your vault, lending market or basket is about to price with. NAVGuard reads the mint,
          applies the activation clock, pause state and a safety window, and aborts the parent transaction when the
          number is wrong.
        </p>
        <ul>
          <li><b>GREEN</b> effective multiplier matches, proceed</li>
          <li><b>AMBER</b> inside a corporate action window, in kind only</li>
          <li><b>RED</b> stale, paused or invalid, reject</li>
        </ul>
      </div>
      <pre className="code-card"><code>{SNIPPET}</code></pre>
    </section>
  );
}
