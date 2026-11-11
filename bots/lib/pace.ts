import { readFileSync, existsSync } from "node:fs";
import { SLOW } from "./config.js";
import { siteFetch } from "./feed.js";
import type { Log } from "./log.js";

export const PAUSED = Number.POSITIVE_INFINITY;
const warned = new Map<string, number>();
function warnOnce(log: Log, msg: string, x: Record<string, unknown>) { const t = warned.get(msg) ?? 0; if (Date.now() - t > 600_000) { warned.set(msg, Date.now()); log.warn(msg, x); } }
let lastFactor = 1;
let cache: { at: number; f: number } | null = null;

export async function paceFactor(log: Log, probeAccount: string): Promise<number> {
  if (cache && Date.now() - cache.at < 60_000) return cache.f;
  let factor = 1;
  const du = process.env.BOTS_DISK_URL;
  if (du) {
    try {
      const r = await fetch(du, { signal: AbortSignal.timeout(5_000) });
      const d: any = await r.json();
      if (typeof d.freePct !== "number") throw new Error("no freePct");
      if (d.at && Date.now() - Date.parse(d.at) > 20 * 60_000) { warnOnce(log, "disk-guard-stale", { at: d.at, factor: 2 }); factor = 2; }
      else if (d.freePct < SLOW.diskStopPct) factor = PAUSED;
      else if (d.freePct < SLOW.diskHalfPct) factor = 2;
      return finish(log, factor, probeAccount);
    } catch (e) { warnOnce(log, "disk-url-unreadable", { e: String(e).slice(0, 120) });  }
  }
  const f = process.env.BOTS_DISK_FILE;
  if (!f || !existsSync(f)) { warnOnce(log, "disk-guard-off", { reason: f ? "BOTS_DISK_FILE missing" : "BOTS_DISK_FILE not set", factor: 2 }); factor = 2; }
  if (f && existsSync(f)) {
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      if (d.at && Date.now() - Date.parse(d.at) > 20 * 60_000) { warnOnce(log, "disk-guard-stale", { at: d.at, factor: 2 }); factor = 2; }
      if (typeof d.freePct === "number") {
        if (d.freePct < SLOW.diskStopPct) factor = PAUSED;
        else if (d.freePct < SLOW.diskHalfPct) factor = 2;
      }
    } catch { warnOnce(log, "disk-guard-unreadable", { factor: 2 }); factor = Math.max(factor, 2); }
  }
  return finish(log, factor, probeAccount);
}

async function finish(log: Log, factor: number, probeAccount: string): Promise<number> {
  try {
    const r = await siteFetch(`/api/faucet/${probeAccount}`);
    const j: any = await r.json();
    const left = j?.data?.reserveLeft;
    if (left && factor !== PAUSED && Number(BigInt(left.raw) / 10n ** BigInt(left.decimals)) < SLOW.faucetReserveMin) factor = Math.max(factor, SLOW.slowFactor);
  } catch {  }
  if (factor !== lastFactor) { log.info("pace", { factor: factor === PAUSED ? "paused" : factor }); lastFactor = factor; }
  cache = { at: Date.now(), f: factor };
  return factor;
}
