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
