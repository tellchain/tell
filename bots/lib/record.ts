import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { INGEST_URL, RECORD_DIR } from "./config.js";
import type { Log } from "./log.js";

export type Attempt = {
  kind: "target" | "sandwich" | "lp" | "execute" | "auction";
  pool?: "sealed" | "open";
  poolAddress?: string;
  strategy?: "front-back" | "unopened-both-sides" | "late-seal";
  side?: "buy" | "sell";
  amountIn?: string;
  received?: string;
  targetSig?: string;
  targetPlace?: number;
  frontSigs?: string[];
  backSigs?: string[];
  sigs?: string[];
  takenTestUnits?: string;
  bondsLostTestUnits?: string;
  result: "cut-in" | "no-gain" | "failed" | "ok" | "skipped";
  reason?: string;
  slot?: number;
  sampling?: string;
  placedAround?: boolean;
};

const ingest = { ok: 0, fail: 0, streak: 0, lastOk: null as string | null, lastFail: null as string | null, lastError: undefined as string | undefined };

export async function record(log: Log, a: Attempt) {
  let slotNow: number | undefined = a.slot;
  if (slotNow === undefined) { try { slotNow = await (await import("./rpc.js")).conn.getSlot("confirmed"); } catch {  } }
  const row = { id: randomUUID(), at: new Date().toISOString(), ...a, slot: slotNow };
  try {
    mkdirSync(RECORD_DIR, { recursive: true });
    appendFileSync(join(RECORD_DIR, `${a.kind}.jsonl`), JSON.stringify(row) + "\n");
  } catch (e) { log.warn("record-file-failed", { e: String(e) }); }
  if (!INGEST_URL) return;
  const health = join(RECORD_DIR, "..", "ingest-health.json");
  const note = (ok: boolean, why?: string) => {
    ingest.ok += ok ? 1 : 0; ingest.fail += ok ? 0 : 1; ingest.streak = ok ? 0 : ingest.streak + 1;
    if (ok) ingest.lastOk = new Date().toISOString(); else { ingest.lastFail = new Date().toISOString(); ingest.lastError = why; }
    try { writeFileSync(health, JSON.stringify({ worker: process.env.NPG_WORKER_ID ?? "bots", ...ingest }) + "\n"); } catch {  }
    if (!ok && ingest.streak % 10 === 1) log.error("ingest-failing", { streak: ingest.streak, why });
  };
  try {
    const r = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.BOTS_INGEST_TOKEN ?? process.env.BOTS_SITE_TOKEN ?? ""}` },
      body: JSON.stringify(row),
    });
    if (!r.ok) { log.warn("ingest-refused", { status: r.status }); note(false, `http ${r.status}`); } else note(true);
  } catch (e) { log.warn("ingest-failed", { e: String(e) }); note(false, String(e).slice(0, 120)); }
}

export function recordSync(a: Attempt) {
  try { mkdirSync(RECORD_DIR, { recursive: true }); appendFileSync(join(RECORD_DIR, `${a.kind}.jsonl`), JSON.stringify({ id: randomUUID(), at: new Date().toISOString(), ...a }) + "\n"); } catch {  }
}
