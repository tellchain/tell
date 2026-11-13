import { logger } from "./lib/log.js";
import { stopper, wait, waitForRpc } from "./lib/stop.js";
import { keyFor } from "./lib/keys.js";
import { getChain } from "./lib/impl.js";
import { PERIOD } from "./lib/config.js";
import { sendViaRelay } from "./lib/feed.js";
import { record } from "./lib/record.js";
import { sealLiquidityIxs, openIxs, envelopeRaw, IDS } from "./lib/adapter.js";
import { slot, send } from "./lib/rpc.js";
import { createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { waitDone, bondsBurned } from "./lib/order.js";
import { paceFactor, PAUSED } from "./lib/pace.js";

const log = logger("bot-lp");
const stop = stopper(log);
await waitForRpc(log);
const isqrt = (n: bigint) => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
const GAP_BPS = BigInt(process.env.BOTS_LP_GAP_BPS ?? "100");

async function one() {
  const kp = await keyFor("bot-lp");
  const chain = await getChain();
  const { sealed: [sp], open: [op] } = await chain.pools();
  const [rs, ro] = await Promise.all([chain.reserves(sp), chain.reserves(op)]);
  const ds = isqrt(rs.base * rs.quote), dop = isqrt(ro.base * ro.quote);
  const [low, high, lowPool, kind] = ds < dop ? [rs, ro, sp, "sealed" as const] : [ro, rs, op, "open" as const];
  const dl = ds < dop ? ds : dop, dh = ds < dop ? dop : ds;
  if (dh === 0n || ((dh - dl) * 10_000n) / dh <= GAP_BPS) return;
  const base = (low.base * (dh - dl)) / dl, quote = (low.quote * (dh - dl)) / dl;
  const bal = await chain.balances(kp.publicKey);
  if (bal.ore < base || bal.test < quote) { await record(log, { kind: "lp", pool: kind, result: "skipped", reason: "low balance" }); return; }
  if (kind === "open") {
    const r = await sendViaRelay(await chain.buildOpenLiquidity(kp, lowPool, "add", base, quote), kp);
    await record(log, { kind: "lp", pool: "open", poolAddress: op.toBase58(), sigs: [r.sig ?? ""], result: r.err ? "failed" : "ok", reason: r.err ? JSON.stringify(r.err) : undefined });
    return;
  }
  const { ixs, sealed } = await sealLiquidityIxs(kp, lowPool, base, quote);
  const s = await sendViaRelay(ixs, kp);
  if (s.err) { await record(log, { kind: "lp", pool: "sealed", result: "failed", reason: JSON.stringify(s.err) }); return; }
  let e: any = null;
  for (let i = 0; i < 12 && !e; i++) { e = await envelopeRaw(sealed.envelope); if (!e) await wait(250); }
  if (!e) { await record(log, { kind: "lp", pool: "sealed", sigs: [s.sig ?? ""], result: "failed", reason: "envelope not readable after its seal" }); return; }
  while ((await slot()) <= Number(e.sealedSlot)) await wait(100);
  if ((await slot()) > Number(e.openDeadline)) { await record(log, { kind: "lp", pool: "sealed", sigs: [s.sig ?? ""], result: "failed", reason: "window passed before open", bondsLostTestUnits: String(e.bond) }); return; }
  const o = await sendViaRelay(await openIxs(kp, sealed), kp);
  const d = await waitDone(sealed.envelope, 120_000);
  const filled = !o.err && d.state === "executed" && d.consumerOk;
  await record(log, { kind: "lp", pool: "sealed", poolAddress: sp.toBase58(), targetPlace: sealed.place, sigs: [s.sig ?? "", o.sig ?? ""].filter(Boolean),
    result: filled ? "ok" : "failed", reason: o.err ? JSON.stringify(o.err) : filled ? undefined : "not filled: " + d.state,
    bondsLostTestUnits: String(await bondsBurned([sealed.envelope])) });
  void high;
}

const REFILL_BELOW = 100_000_000_000n, REFILL = 200_000_000_000n;
async function refillAttacker() {
  const kp = await keyFor("bot-lp");
  const to = (await keyFor("bot-sandwich", 2)).publicKey;
  const chain = await getChain();
  const have = (await chain.balances(to)).test;
  if (have >= REFILL_BELOW) return;
  const mine = (await chain.balances(kp.publicKey)).test;
  if (mine < REFILL * 2n) { await record(log, { kind: "lp", result: "skipped", reason: `refill: bot-lp holds ${mine}, too little to refill the sealed attacker` }); return; }
  const r = await send([createTransferInstruction(getAssociatedTokenAddressSync(IDS.test, kp.publicKey), getAssociatedTokenAddressSync(IDS.test, to), kp.publicKey, REFILL)], kp);
  await record(log, { kind: "lp", sigs: [r.sig], result: r.err ? "failed" : "ok", reason: `project-internal refill: 200,000 TEST bot-lp -> bot-sandwich (sealed key), it held ${have}` + (r.err ? ": " + JSON.stringify(r.err) : "") });
}

log.info("boot", { periodSec: PERIOD.lpSec });
for (;;) {
  if (stop.stopping) break;
  let f = 1;
  try { f = await paceFactor(log, (await keyFor("bot-lp")).publicKey.toBase58()); } catch { f = 1; }
  if (f !== PAUSED) await stop.step(async () => {
    try { await one(); } catch (e) { log.error("tick", { e: String(e) }); }
    try { await refillAttacker(); } catch (e) { log.error("refill", { e: String(e) }); }
  });
  await wait(PERIOD.lpSec * 1000 * (f === PAUSED ? 1 : f));
}
