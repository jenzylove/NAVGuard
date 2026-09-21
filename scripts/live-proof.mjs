import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getPausableConfig,
  getScaledUiAmountConfig,
  unpackMint,
} from "@solana/spl-token";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
const POSITION_SHARES = 100_000;

function money(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const connection = new Connection(RPC_URL, "confirmed");
const account = await connection.getAccountInfo(SPYX_MINT, "confirmed");
if (!account) throw new Error("SPYx mint account was not found");

const mint = unpackMint(SPYX_MINT, account, TOKEN_2022_PROGRAM_ID);
const scaled = getScaledUiAmountConfig(mint);
if (!scaled) throw new Error("SPYx does not expose Scaled UI Amount state");

const now = Math.floor(Date.now() / 1_000);
const activation = Number(scaled.newMultiplierEffectiveTimestamp);
const effective = now >= activation ? scaled.newMultiplier : scaled.multiplier;
const stored = scaled.multiplier;
const pausable = getPausableConfig(mint);
const vulnerableNav = POSITION_SHARES * stored;
const guardedNav = POSITION_SHARES * effective;
const difference = guardedNav - vulnerableNav;
const differenceBps = ((effective / stored) - 1) * 10_000;

console.log("\nNAVGuard live proof — SPYx mainnet mint");
console.log("────────────────────────────────────────");
console.log(`Mint                 ${SPYX_MINT.toBase58()}`);
console.log(`Stored field         ${stored.toFixed(9)}`);
console.log(`Effective now        ${effective.toFixed(9)}`);
console.log(`Activated            ${new Date(activation * 1_000).toISOString()}`);
console.log(`Mint paused          ${pausable?.paused ?? "extension missing"}`);
console.log("");
console.log(`Reference position   ${POSITION_SHARES.toLocaleString()} shares`);
console.log(`Naive vault NAV      ${money(vulnerableNav)}`);
console.log(`Clock-aware NAV      ${money(guardedNav)}`);
console.log(`Silent accounting gap ${money(difference)} (${differenceBps.toFixed(2)} bps)`);
console.log("");

if (pausable?.paused) {
  console.log("NAVGuard verdict     RED — mint is paused; settlement must abort");
  process.exitCode = 2;
} else if (Math.abs(differenceBps) > 0.01) {
  console.log("NAVGuard verdict     RED for the naive multiplier; guarded settlement aborts");
} else {
  console.log("NAVGuard verdict     GREEN — caller and effective multiplier agree");
}
