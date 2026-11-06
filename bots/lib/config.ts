import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const BOTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const num = (k: string, d: number) => {
  const v = process.env[k];
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${k} is not a number: ${v}`);
  return n;
};

export const RPC_SET = !!(process.env.TELL_RPC_URL ?? "").trim();
export const RPC_URL = (process.env.TELL_RPC_URL ?? "").trim() || "http://127.0.0.1:8899";
export const RPS_CAP = num("BOTS_RPS_CAP", 8);
export const READ_RPC_URL = (process.env.TELL_READ_RPC_URL ?? "").trim();

export const PERIOD = {
  targetSec: num("BOTS_TARGET_PERIOD_SEC", 60),
  lpSec: num("BOTS_LP_PERIOD_SEC", 300),
  executorMs: num("BOTS_EXECUTOR_TICK_MS", 400),
  auctioneerSec: num("BOTS_AUCTIONEER_PERIOD_SEC", 1800),
};

export const SLOW = {
  faucetReserveMin: num("BOTS_FAUCET_RESERVE_MIN", 1_000_000),
  diskHalfPct: num("BOTS_DISK_HALF_PCT", 20),
  diskStopPct: num("BOTS_DISK_STOP_PCT", 10),
  slowFactor: num("BOTS_SLOW_FACTOR", 4),
};

export const TARGET = {
  sizePctOfReserve: num("BOTS_TARGET_SIZE_PCT", 2),
  slippageBps: num("BOTS_TARGET_SLIPPAGE_BPS", 300),
};

export const INGEST_URL = process.env.BOTS_INGEST_URL ?? "";
export const RECORD_DIR = process.env.BOTS_RECORD_DIR ?? join(BOTS_DIR, "records");

export const BOT_ROLES = ["executor", "bot-lp", "bot-target", "bot-sandwich", "bot-auctioneer"] as const;
export type BotRole = (typeof BOT_ROLES)[number];
