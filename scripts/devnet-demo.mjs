// Reproduces the stale multiplier exploit on devnet, then shows NAVGuard block it.
//
// 1. Create a Token-2022 mint with the Scaled UI Amount extension (multiplier 1.0),
//    the same extension xStocks use.
// 2. Deposit into the reference vault at multiplier 1.0.
// 3. Schedule a 2:1 corporate action a few seconds ahead and let it activate. The
//    mint's stored `multiplier` field now trails the effective one, exactly the
//    state six of the ten largest xStocks were in on 2026-09-20.
// 4. redeem_guarded: NAVGuard aborts the transaction (MultiplierMismatch).
// 5. redeem_unguarded: the vault pays out at the stale multiplier and overpays.
//
// Usage: node scripts/devnet-demo.mjs [path/to/payer.json]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createInitializeScaledUiAmountConfigInstruction,
  createMintToInstruction,
  createUpdateMultiplierDataInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
  getScaledUiAmountConfig,
  getMint,
} from "@solana/spl-token";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DECIMALS = 8;
const UNIT = 10n ** BigInt(DECIMALS);
const SPLIT = 2.0;

const programId = (path) =>
  new PublicKey(readFileSync(path, "utf8").match(/declare_id!\("(\w+)"\)/)[1]);
const NAVGUARD = programId("programs/navguard/src/lib.rs");
const VAULT_PROGRAM = programId("programs/reference-vault/src/lib.rs");

const keypairPath = process.argv[2] ?? `${homedir()}/.config/solana/id.json`;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
const connection = new Connection(RPC, "confirmed");
const explorer = (sig) =>
  RPC.includes("devnet")
    ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    : `localnet:${sig}`;

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
const send = (ixs, signers = []) =>
  sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [payer, ...signers], {
    commitment: "confirmed",
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const log = { cluster: RPC, navguard: NAVGUARD.toBase58(), vault_program: VAULT_PROGRAM.toBase58(), steps: [] };
  const step = (name, data) => {
    log.steps.push({ name, ...data });
    console.log(`\n# ${name}`);
    for (const [k, v] of Object.entries(data)) console.log(`  ${k}: ${v}`);
  };

  // 1. Mint with Scaled UI Amount at 1.0
  const mint = Keypair.generate();
  const space = getMintLen([ExtensionType.ScaledUiAmountConfig]);
  const rent = await connection.getMinimumBalanceForRentExemption(space);
  let sig = await send(
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space,
        lamports: rent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeScaledUiAmountConfigInstruction(mint.publicKey, payer.publicKey, 1.0, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint.publicKey, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ],
    [mint],
  );
  step("create stock mint (Token-2022, Scaled UI Amount 1.0)", { mint: mint.publicKey.toBase58(), tx: explorer(sig) });

  // Two holders: a victim who stays in the vault, and the redeemer.
  const victim = Keypair.generate();
  const holders = [payer, victim];
  sig = await send([
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: victim.publicKey, lamports: 20_000_000 }),
    ...holders.flatMap((h) => {
      const ata = getAssociatedTokenAddressSync(mint.publicKey, h.publicKey, false, TOKEN_2022_PROGRAM_ID);
      return [
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, h.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(mint.publicKey, ata, payer.publicKey, 100n * UNIT, [], TOKEN_2022_PROGRAM_ID),
      ];
    }),
  ]);
  step("fund two holders with 100 tokens each", { tx: explorer(sig) });

  // 2. Vault
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), mint.publicKey.toBuffer()], VAULT_PROGRAM);
  const vaultToken = getAssociatedTokenAddressSync(mint.publicKey, vault, true, TOKEN_2022_PROGRAM_ID);
  sig = await send([
    new TransactionInstruction({
      programId: VAULT_PROGRAM,
      keys: [
        meta(payer.publicKey, true, true),
        meta(mint.publicKey),
        meta(vault, true),
        meta(vaultToken, true),
        meta(TOKEN_2022_PROGRAM_ID),
        meta(ASSOCIATED_TOKEN_PROGRAM_ID),
        meta(SystemProgram.programId),
      ],
      data: disc("initialize"),
    }),
  ]);
  step("initialize reference vault", { vault: vault.toBase58(), tx: explorer(sig) });

  const positionOf = (owner) =>
    PublicKey.findProgramAddressSync([Buffer.from("position"), vault.toBuffer(), owner.toBuffer()], VAULT_PROGRAM)[0];
  const ataOf = (owner) => getAssociatedTokenAddressSync(mint.publicKey, owner, false, TOKEN_2022_PROGRAM_ID);

  for (const h of holders) {
    sig = await send(
      [
        new TransactionInstruction({
          programId: VAULT_PROGRAM,
          keys: [
            meta(h.publicKey, true, true),
            meta(mint.publicKey),
            meta(vault, true),
            meta(vaultToken, true),
            meta(ataOf(h.publicKey), true),
            meta(positionOf(h.publicKey), true),
            meta(TOKEN_2022_PROGRAM_ID),
            meta(SystemProgram.programId),
          ],
          data: Buffer.concat([disc("deposit"), u64(50n * UNIT)]),
        }),
      ],
      h === payer ? [] : [h],
    );
    step(`deposit 50 tokens (${h === payer ? "redeemer" : "other depositor"})`, { tx: explorer(sig) });
  }

  // 3. Schedule a 2:1 split a few seconds out and let it activate.
  const effectiveAt = Math.floor(Date.now() / 1000) + 8;
  sig = await send([
    createUpdateMultiplierDataInstruction(mint.publicKey, payer.publicKey, SPLIT, BigInt(effectiveAt), [], TOKEN_2022_PROGRAM_ID),
  ]);
  step("schedule 2:1 corporate action", { new_multiplier: SPLIT, effective_at: new Date(effectiveAt * 1000).toISOString(), tx: explorer(sig) });
  while ((await connection.getBlockTime(await connection.getSlot())) <= effectiveAt + 2) await sleep(2000);

  const mintState = await getMint(connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const cfg = getScaledUiAmountConfig(mintState);
  step("mint state after activation", {
    stored_multiplier: cfg.multiplier,
    new_multiplier: cfg.newMultiplier,
    stale: cfg.multiplier !== cfg.newMultiplier,
  });

  const redeemIx = (name, shares) =>
    new TransactionInstruction({
      programId: VAULT_PROGRAM,
      keys: [
        meta(payer.publicKey, true, true),
        meta(mint.publicKey),
        meta(vault, true),
        meta(vaultToken, true),
        meta(ataOf(payer.publicKey), true),
        meta(positionOf(payer.publicKey), true),
        meta(NAVGUARD),
        meta(TOKEN_2022_PROGRAM_ID),
      ],
      data: Buffer.concat([disc(name), u64(shares)]),
    });
  const shares = 50n * UNIT; // the redeemer's full position at multiplier 1.0
  const balance = async () => (await getAccount(connection, ataOf(payer.publicKey), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

  // 4. Guarded redeem: must fail.
  try {
    await send([redeemIx("redeem_guarded", shares)]);
    step("redeem_guarded", { result: "UNEXPECTED SUCCESS" });
  } catch (err) {
    const logs = err.logs ?? (await err.getLogs?.(connection)) ?? [];
    const reason = logs.find((l) => l.includes("Error Code")) ?? String(err.message).split("\n")[0];
    step("redeem_guarded (NAVGuard CPI)", { result: "REVERTED, no funds moved", reason });
  }

  // 5. Unguarded redeem: succeeds and overpays.
  const before = await balance();
  sig = await send([redeemIx("redeem_unguarded", shares)]);
  const paid = (await balance()) - before;
  const owed = BigInt(Math.floor(Number(shares) / SPLIT));
  step("redeem_unguarded", {
    raw_paid: `${Number(paid) / Number(UNIT)} tokens`,
    raw_owed: `${Number(owed) / Number(UNIT)} tokens`,
    overpaid: `${Number(paid - owed) / Number(UNIT)} tokens taken from the other depositor`,
    tx: explorer(sig),
  });

  mkdirSync("docs", { recursive: true });
  const out = `docs/${RPC.includes("devnet") ? "devnet" : "localnet"}-proof.json`;
  writeFileSync(out, JSON.stringify(log, null, 2));
  console.log(`\nsaved ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
