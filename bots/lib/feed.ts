import { Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { conn, send } from "./rpc.js";
import { wait } from "./stop.js";

export const SITE_URL = process.env.BOTS_SITE_URL ?? "http://127.0.0.1:3000";
export function siteFetch(path: string | URL, init: RequestInit = {}) {
  const u = typeof path === "string" ? new URL(path, SITE_URL) : path;
  const h = new Headers(init.headers);
  if (process.env.BOTS_SITE_TOKEN) h.set("authorization", `Bearer ${process.env.BOTS_SITE_TOKEN}`);
  return fetch(u, { ...init, headers: h });
}

export async function sendViaRelay(ixs: TransactionInstruction[], payer: Keypair, extra: Keypair[] = [], opts: { commitment?: "processed" | "confirmed" } = {}) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(payer, ...extra);
  if (process.env.BOTS_RELAY === "direct") return send(ixs, payer, extra, { commitment: opts.commitment });
  const r = await siteFetch("/api/tx/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx: tx.serialize().toString("base64") }),
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) return { sig: null as string | null, slot: null as number | null, err: j?.error ?? `relay ${r.status}` };
  const sig: string = j.data.signature;
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) return { sig, slot: st.slot, err: st.err };
    const want = opts.commitment ?? "confirmed";
    if (st && (st.confirmationStatus === want || st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { sig, slot: st.slot, err: null };
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) return { sig, slot: null, err: "expired" };
    await wait(opts.commitment === "processed" ? 100 : 250);
  }
}
