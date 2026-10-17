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
