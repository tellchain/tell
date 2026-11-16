import { logger } from "./lib/log.js";
import { stopper, wait, waitForRpc } from "./lib/stop.js";
import { keyFor } from "./lib/keys.js";
import { getChain } from "./lib/impl.js";
import { cpOut, type Side } from "./lib/chain.js";
import { PERIOD, TARGET } from "./lib/config.js";
import { sealOnly, openSealed, waitDone, bondsBurned } from "./lib/order.js";
import { sendViaRelay } from "./lib/feed.js";
import { record } from "./lib/record.js";
import { paceFactor, PAUSED } from "./lib/pace.js";

const log = logger("bot-target");
const stop = stopper(log);
await waitForRpc(log);
let side: Side = "buy";
log.info("boot", { periodSec: PERIOD.targetSec });

async function one(side: Side) {
  const kp = await keyFor("bot-target");
  const chain = await getChain();
  const { sealed: [sp], open: [op] } = await chain.pools();
  const [rs, ro] = await Promise.all([chain.reserves(sp), chain.reserves(op)]);
  const inRes = (r: typeof rs) => (side === "buy" ? r.quote : r.base);
  const min = inRes(rs) < inRes(ro) ? inRes(rs) : inRes(ro);
  const amountIn = (min * BigInt(Math.round(TARGET.sizePctOfReserve * 100))) / 10_000n;
  const bal = await chain.balances(kp.publicKey);
  const have = side === "buy" ? bal.test : bal.ore;
  if (amountIn <= 0n || have < amountIn * 2n) { await record(log, { kind: "target", result: "skipped", reason: `low balance ${have}` }); return; }
  const slip = (r: typeof rs) => (cpOut(r, side, amountIn) * BigInt(10_000 - TARGET.slippageBps)) / 10_000n;

  {
    const r = await sendViaRelay(await chain.buildOpenSwap(kp, { pool: op, side, amountIn, minOut: slip(ro) }), kp);
    const got = r.sig && !r.err ? await chain.received(r.sig, kp.publicKey, side) : null;
    await record(log, { kind: "target", pool: "open", poolAddress: op.toBase58(), side, amountIn: String(amountIn), received: got === null ? undefined : String(got),
      targetSig: r.sig ?? undefined, result: r.err ? "failed" : "ok", reason: r.err ? JSON.stringify(r.err) : undefined, slot: r.slot ?? undefined });
  }

  {
    const rs2 = await chain.reserves(sp);
    const content = { pool: sp, side, amountIn, minOut: slip(rs2) };
    const want = side === "buy" ? amountIn : (cpOut(rs2, side, amountIn) * 102n) / 100n;
    const capMax = (rs2.quote * 5n) / 100n;
    if (want > capMax) { await record(log, { kind: "target", pool: "sealed", result: "skipped", reason: "order above the 5% cap" }); return; }
    const before = await chain.balances(kp.publicKey);
    const s = await sealOnly(kp, content, "relay", want);
    if (!s.ok) { await record(log, { kind: "target", pool: "sealed", result: "failed", reason: JSON.stringify(s.err) }); return; }
    const o = await openSealed(kp, s.sealed, s.sealedSlot, s.openDeadline, "relay");
    const d = await waitDone(s.sealed.envelope);
    const after = await chain.balances(kp.publicKey);
    const filled = d.state === "executed" && d.consumerOk;
    const received = filled ? (side === "buy" ? after.ore - before.ore : after.test - before.test) : 0n;
    await record(log, { kind: "target", pool: "sealed", poolAddress: sp.toBase58(), side, amountIn: String(amountIn), targetPlace: s.sealed.place, targetSig: s.sig,
      sigs: [s.sig, o.sig ?? ""].filter(Boolean), result: o.ok && filled ? "ok" : "failed",
      reason: o.ok ? (d.state === "executed" ? (d.consumerOk ? undefined : "consumer not filled") : d.state) : JSON.stringify(o.err), slot: d.executedSlot ?? undefined,
      received: d.state === "executed" || d.state === "skipped" ? String(received) : undefined,
      bondsLostTestUnits: String(await bondsBurned([s.sealed.envelope])) });
  }
}

for (;;) {
  if (stop.stopping) break;
  const t0 = Date.now();
  let f = 1;
  try { f = await paceFactor(log, (await keyFor("bot-target")).publicKey.toBase58()); } catch { f = 1; }
  if (f === PAUSED) { await wait(60_000); continue; }
  await stop.step(async () => {
    try { await one(side); }
    catch (e) { log.error("tick", { e: String(e) }); }
    finally { side = side === "buy" ? "sell" : "buy"; }
  });
  await wait(Math.max(1000, PERIOD.targetSec * 1000 * f - (Date.now() - t0)));
}
