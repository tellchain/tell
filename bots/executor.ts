import { logger } from "./lib/log.js";
import { stopper, wait, waitForRpc } from "./lib/stop.js";
import { keyFor } from "./lib/keys.js";
import { send, slot } from "./lib/rpc.js";
import { getChain } from "./lib/impl.js";
import { PERIOD } from "./lib/config.js";
import { SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bots from "./bots.json" with { type: "json" };
import { conn } from "./lib/rpc.js";

const TOPUP_EVERY_MS = 600_000, LOW = 2n * BigInt(LAMPORTS_PER_SOL), TO = 3n * BigInt(LAMPORTS_PER_SOL);
let lastTopup = 0;
let lastStaleCheck = 0;
async function topUp(kp: Awaited<ReturnType<typeof keyFor>>) {
  if (Date.now() - lastTopup < TOPUP_EVERY_MS) return;
  lastTopup = Date.now();
  const keys = (["bot-lp", "bot-target", "bot-sandwich", "bot-auctioneer"] as const).flatMap((r) => ((bots as any)[r] as string[]).map((k) => new PublicKey(k)));
  const bals = await conn.getMultipleAccountsInfo(keys);
  const gaps = keys.map((k, i) => ({ k, gap: BigInt(bals[i]?.lamports ?? 0) < LOW ? TO - BigInt(bals[i]?.lamports ?? 0) : 0n })).filter((x) => x.gap > 0n);
  if (!gaps.length) return;
  let spend = BigInt(await conn.getBalance(kp.publicKey)) - BigInt(LAMPORTS_PER_SOL);
  const ixs = [];
  for (const x of gaps.sort((a, b) => (a.gap > b.gap ? -1 : 1))) {
    if (spend < x.gap) { log.warn("topup-short", { wallet: x.k.toBase58(), gap: String(x.gap), left: String(spend) }); continue; }
    spend -= x.gap;
    ixs.push(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: x.k, lamports: x.gap }));
  }
  if (!ixs.length) return;
  const r = await send(ixs, kp);
  log.info("topup", { wallets: ixs.length, sig: r.sig, err: r.err ?? undefined });
}

const log = logger("executor");
const stop = stopper(log);
await waitForRpc(log);
log.info("boot", { tickMs: PERIOD.executorMs });

for (;;) {
  if (stop.stopping) break;
  await stop.step(async () => {
    try {
      const kp = await keyFor("executor");
      await topUp(kp).catch((e) => log.warn("topup", { e: String(e) }));
      const chain = await getChain();
      const s = await slot();
      if (s % 50 === 0 || Date.now() - lastStaleCheck > 60_000) {
        lastStaleCheck = Date.now();
        for (const line of await chain.staleLines(s)) {
          const r = await send(await chain.buildVoidStale(kp.publicKey, line), kp);
          log.warn("void-stale", { line: line.toBase58(), sig: r.sig, err: r.err ?? undefined });
        }
      }
      for (const b of await chain.dueBatches(s)) {
        try {
          let left = b.places;
          while (left.length) {
            const [ixs] = await chain.buildExecute(kp.publicKey, b.line, left.slice(0, 4));
            const n = ixs.length;
            const r = await send(ixs, kp, [], { cuLimit: 1_400_000 });
            log[r.err ? "warn" : "info"]("execute", { line: b.line.toBase58(), places: left.slice(0, n), sig: r.sig, slot: r.slot, err: r.err ?? undefined });
            if (r.err) break;
            left = left.slice(n);
          }
        } catch (e) {
          if (/0x1778|NotNextInLine/.test(String(e))) log.info("cursor-moved", { line: b.line.toBase58() });
          else log.error("line", { line: b.line.toBase58(), e: String(e).slice(0, 500) });
        }
      }
    } catch (e) {
      if (/0x1778|NotNextInLine/.test(String(e))) log.info("cursor-moved", {});
      else { log.error("tick", { e: String(e) }); await wait(2000); }
    }
  });
  await wait(PERIOD.executorMs);
}
