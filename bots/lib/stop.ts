import type { Log } from "./log.js";
export function stopper(log: Log) {
  let stopping = false;
  let busy = false;
  let inflight = 0;
  const hooks: (() => void)[] = [];
  const bye = () => { for (const h of hooks) { try { h(); } catch {  } } process.exit(0); };
  const exitWhenIdle = () => { if (!busy && inflight === 0) bye(); };
  const onSig = (sig: string) => {
    log.info("signal", { sig, busy, inflight });
    stopping = true;
    exitWhenIdle();
    setTimeout(bye, 25_000).unref();
  };
  process.on("SIGTERM", () => onSig("SIGTERM"));
  process.on("SIGINT", () => onSig("SIGINT"));
  return {
    get stopping() { return stopping; },
    onExit(h: () => void) { hooks.push(h); },
    track<T>(p: Promise<T>): Promise<T> {
      inflight++;
      return p.finally(() => { inflight--; if (stopping) exitWhenIdle(); });
    },
    async step<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (stopping) return undefined;
      busy = true;
      try { return await fn(); } finally { busy = false; if (stopping) exitWhenIdle(); }
    },
  };
}
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForRpc(log: Log) {
  const { RPC_SET } = await import("./config.js");
  if (RPC_SET || process.env.NODE_ENV !== "production") return;
  for (;;) { log.warn("idle", { reason: "TELL_RPC_URL is not set (the private RPC through the forwarder)" }); await wait(300_000); }
}
