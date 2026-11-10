import { Connection, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, type Commitment } from "@solana/web3.js";
import { RPC_URL, RPS_CAP, READ_RPC_URL } from "./config.js";
import { wait } from "./stop.js";

let tokens = RPS_CAP;
let last = Date.now();
async function take() {
  for (;;) {
    const now = Date.now();
    tokens = Math.min(RPS_CAP, tokens + ((now - last) / 1000) * RPS_CAP);
    last = now;
    if (tokens >= 1) { tokens -= 1; return; }
    await wait(Math.ceil(1000 / RPS_CAP));
  }
}

const rawFetch = globalThis.fetch;
export const sendConn = new Connection(RPC_URL, { commitment: "confirmed" });
export const conn = new Connection(READ_RPC_URL || RPC_URL, {
  commitment: "confirmed",
  disableRetryOnRateLimit: false,
  fetch: (async (input: any, init?: any) => { await take(); return rawFetch(input, init); }) as typeof fetch,
});

export type Sent = { sig: string; slot: number | null; err: unknown };

export async function send(ixs: TransactionInstruction[], payer: Keypair, extra: Keypair[] = [], opts: { cuLimit?: number; commitment?: Commitment } = {}): Promise<Sent> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight });
  if (opts.cuLimit) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cuLimit }));
  tx.add(...ixs);
  tx.sign(payer, ...extra);
  const raw = tx.serialize();
  const sig = await sendConn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  const want = opts.commitment ?? "confirmed";
  for (let i = 0; ; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === want || st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { sig, slot: st.slot, err: st.err };
    if (st?.err) return { sig, slot: st.slot, err: st.err };
    const h = await conn.getBlockHeight("confirmed");
    if (h > lastValidBlockHeight) return { sig, slot: null, err: "expired" };
    if (i % 4 === 3) await sendConn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await wait(want === "processed" ? 100 : 250);
  }
}

export async function slot(commitment: "processed" | "confirmed" = "confirmed"): Promise<number> { return conn.getSlot(commitment); }
