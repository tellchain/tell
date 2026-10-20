import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { getAccount, getMint, MINT_SIZE, TOKEN_PROGRAM_ID, ACCOUNT_SIZE, createInitializeMint2Instruction, createInitializeAccount3Instruction,
  createMintToInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import * as C from "../client/index.js";

export const RPC = process.env.TELL_RPC || "http://127.0.0.1:8899";
export const conn = new Connection(RPC, "confirmed");

export async function funded(sol = 20) {
  const k = Keypair.generate();
  const sig = await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL);
  await waitSig(sig);
  return k;
}

export function provider(kp) {
  return new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
}

export async function waitSig(sig) {
  for (let i = 0; i < 300; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s?.err) { const e = new Error("tx failed " + sig + " " + JSON.stringify(s.err)); const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null); e.logs = t?.meta?.logMessages; throw e; }
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return sig;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("not confirmed " + sig);
}

export async function send(ixs, signers, cu = 600_000) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  return waitSig(await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" }));
}

export async function createMint(_c, payer, authority, freeze, decimals) {
  const kp = Keypair.generate();
  await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space: MINT_SIZE, lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(kp.publicKey, decimals, authority, freeze)], [payer, kp], 200_000);
  return kp.publicKey;
}
export async function createAccount(_c, payer, mint, owner, kp) {
  await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, space: ACCOUNT_SIZE, lamports: await conn.getMinimumBalanceForRentExemption(ACCOUNT_SIZE), programId: TOKEN_PROGRAM_ID }),
    createInitializeAccount3Instruction(kp.publicKey, mint, owner)], [payer, kp], 200_000);
  return kp.publicKey;
}
export async function mintTo(_c, payer, mint, dest, authority, amount) {
  return send([createMintToInstruction(mint, dest, authority.publicKey, amount)], authority === payer ? [payer] : [payer, authority], 200_000);
}
export async function getOrCreateAssociatedTokenAccount(_c, payer, mint, owner) {
  const address = getAssociatedTokenAddressSync(mint, owner, true);
  await send([createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, address, owner, mint)], [payer], 200_000);
  return { address };
}

export const slot = () => conn.getSlot("confirmed");
export async function waitSlot(target) {
  for (;;) { if ((await slot()) >= target) return; await new Promise((r) => setTimeout(r, 150)); }
}

export const bal = async (a) => (await getAccount(conn, a, "confirmed")).amount;
export const supply = async (m) => (await getMint(conn, m, "confirmed")).supply;

import fs from "node:fs";

let REG = null;
async function registrar() {
  const f = process.env.TELL_REGISTRAR;
  const k = f ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")))) : Keypair.generate();
  const sig = await conn.requestAirdrop(k.publicKey, 500 * LAMPORTS_PER_SOL);
  await waitSig(sig);
  return k;
}
export async function world({ openWindow = 4, bondBps = 1000, seedBase = 1_000_000_000_000n, seedQuote = 1_000_000_000_000n, orderedOpen = false, staleSlots = 9000, minBond = 1n } = {}) {
  const reg = REG ?? (REG = await registrar());
  const P = C.programs(provider(reg));
  const quote = await createMint(conn, reg, reg.publicKey, null, 6);
  const base = await createMint(conn, reg, reg.publicKey, null, 6);
  const regBase = await createAccount(conn, reg, base, reg.publicKey, Keypair.generate());
  const regQuote = await createAccount(conn, reg, quote, reg.publicKey, Keypair.generate());
  await mintTo(conn, reg, base, regBase, reg, seedBase * 4n);
  await mintTo(conn, reg, quote, regQuote, reg, seedQuote * 4n);
  for (const prog of [P.sealedPool, P.openPool]) {
    const cfg = C.configPda(prog.programId);
    if (!(await conn.getAccountInfo(cfg))) {
      await send([await prog.methods.initConfig(reg.publicKey).accountsPartial({ payer: reg.publicKey, config: cfg }).instruction()], [reg]);
    } else {
      const c = await prog.account.config.fetch(cfg);
      if (!c.registrar.equals(reg.publicKey)) throw new Error("config registrar belongs to an earlier run: restart the validator (--reset)");
    }
  }
  const sp = await C.createSealedPoolIx(P, { registrar: reg.publicKey, base, quote, registrarBase: regBase, registrarQuote: regQuote,
    baseAmount: seedBase, quoteAmount: seedQuote, openWindow, bondBps, label: "project", orderedOpen, staleSlots, minBond });
  await send([sp.ix], [reg]);
  const op = await C.createOpenPoolIx(P, { registrar: reg.publicKey, base, quote, registrarBase: regBase, registrarQuote: regQuote,
    baseAmount: seedBase, quoteAmount: seedQuote, label: "project" });
  await send([op.ix], [reg]);
  return { reg, P, quote, base, regBase, regQuote, sealedPool: sp.pool, line: sp.line, openPool: op.pool };
}

export async function user(w, { quote = 100_000_000_000n, base = 100_000_000_000n } = {}) {
  const k = await funded(10);

  const q = (await getOrCreateAssociatedTokenAccount(conn, w.reg, w.quote, k.publicKey)).address;
  const b = (await getOrCreateAssociatedTokenAccount(conn, w.reg, w.base, k.publicKey)).address;
  if (quote) await mintTo(conn, w.reg, w.quote, q, w.reg, quote);
  if (base) await mintTo(conn, w.reg, w.base, b, w.reg, base);
  return { k, q, b, P: C.programs(provider(k)) };
}

export async function seal(w, u, content, cap, line = w.line) {
  const secret = C.randomSecret();
  const s = await C.sealIx(u.P, { owner: u.k.publicKey, line, content, secret, cap });
  const sig = await send([s.ix], [u.k]);
  const e = await u.P.envelope.account.envelope.fetch(s.envelope);
  return { ...s, secret, content, sig, sealedSlot: BigInt(e.sealedSlot.toString()), deadline: BigInt(e.openDeadline.toString()), line };
}

export async function open(u, s) {
  await waitSlot(Number(s.sealedSlot) + 1);
  return send([await C.openIx(u.P, { owner: u.k.publicKey, line: s.line, place: s.place, content: s.content, secret: s.secret })], [u.k]);
}
