import type { Keypair, PublicKey } from "@solana/web3.js";
import { sealIxs, openIxs, envelopeRaw, type Sealed } from "./adapter.js";
import { sendViaRelay } from "./feed.js";
import { send, slot } from "./rpc.js";
import { wait } from "./stop.js";
import type { SwapContent } from "./chain.js";

export type Via = "relay" | "direct";

async function readEnvelope(pk: PublicKey) {
  for (let i = 0; i < 12; i++) { const e: any = await envelopeRaw(pk); if (e) return e; await wait(250); }
  throw new Error("envelope not readable after its seal landed: " + pk.toBase58());
}

export async function bondsBurned(envelopes: PublicKey[]): Promise<bigint> {
  let sum = 0n;
  for (const pk of envelopes) {
    const e: any = await envelopeRaw(pk);
    if (!e) continue;
    if (e.state === 3 || e.state === 4 || (e.state === 2 && !e.consumerOk)) sum += BigInt(e.bond.toString());
  }
  return sum;
}
const sendBy = (via: Via, ixs: any[], kp: Keypair, commitment?: "processed" | "confirmed") => (via === "relay" ? sendViaRelay(ixs, kp, [], { commitment }) : send(ixs, kp, [], { commitment }));
const prebuildOpen = async (kp: Keypair, s: Sealed) => { (s as any).openReady = await openIxs(kp, s); };
async function sealedSlots(s: Sealed, landedSlot: number | null) {
  if (landedSlot != null && s.openWindow) return { sealedSlot: landedSlot, openDeadline: landedSlot + s.openWindow };
  const e: any = await readEnvelope(s.envelope);
  return { sealedSlot: Number(e.sealedSlot), openDeadline: Number(e.openDeadline) };
}

const isPlaceTaken = (e: unknown) => /seeds|already in use|ConstraintSeeds|0x7d6|"Custom":2006/i.test(String((e as any)?.message ?? JSON.stringify(e)));
const sendCaught = async (via: Via, ixs: any[], kp: Keypair, commitment?: "processed" | "confirmed") => { try { return await sendBy(via, ixs, kp, commitment); } catch (e) { return { sig: null as string | null, slot: null as number | null, err: (e as Error).message ?? String(e) }; } };

export async function sealOnly(kp: Keypair, c: SwapContent, via: Via, cap?: bigint) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { ixs, sealed } = await sealIxs(kp, c, cap);
    await prebuildOpen(kp, sealed);
    const r = await sendCaught(via, ixs, kp, "processed");
    if (!r.err) return { ok: true as const, sig: r.sig!, sealed, ...(await sealedSlots(sealed, r.slot)) };
    if (!isPlaceTaken(r.err)) return { ok: false as const, sig: r.sig, err: r.err };
  }
  return { ok: false as const, sig: null, err: "place taken three times" };
}

export async function openSealed(kp: Keypair, s: Sealed, sealedSlot: number, openDeadline: number, via: Via) {
  const ixs = (s as any).openReady ?? (await openIxs(kp, s));
  while ((await slot("processed")) <= sealedSlot) await wait(50);
  if ((await slot("processed")) > openDeadline) return { ok: false as const, sig: null, err: "window passed before open" };
  let r: any = null;
  for (let i = 0; i < 3; i++) {
    r = await sendCaught(via, ixs, kp);
    if (!r.err) return { ok: true as const, sig: r.sig! };
    const msg = JSON.stringify(r.err);
    if (/"Custom":600[0-5]|WindowClosed|NotSealed|FingerprintMismatch|BadContent/.test(msg)) break;
    if ((await slot("processed")) >= openDeadline) break;
  }
  return { ok: false as const, sig: r?.sig ?? null, err: r?.err };
}

export async function waitDone(envelope: PublicKey, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const e: any = await envelopeRaw(envelope);
    if (e && e.state >= 2) return { state: e.state === 2 ? "executed" : e.state === 3 ? "skipped" : "voided", executedSlot: Number(e.executedSlot), consumerOk: !!e.consumerOk };
    if (Date.now() - t0 > timeoutMs) return { state: "timeout" as const, executedSlot: null, consumerOk: false };
    await wait(400);
  }
}
