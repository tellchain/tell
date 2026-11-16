import { keyFor } from "../lib/keys.js";
import { getChain } from "../lib/impl.js";
import { cpOut } from "../lib/chain.js";
import { sealOnly, openSealed, waitDone } from "../lib/order.js";

const kp = await keyFor("bot-target");
const chain = await getChain();
const { sealed: [sp] } = await chain.pools();
const r = await chain.reserves(sp);
const amountIn = r.quote / 10_000n;
const t0 = Date.now();
const s = await sealOnly(kp, { pool: sp, side: "buy", amountIn, minOut: (cpOut(r, "buy", amountIn) * 95n) / 100n }, (process.env.MEASURE_VIA as any) ?? "relay", amountIn);
if (!s.ok) { console.log(`seal-to-execute error=${JSON.stringify(s.err)}`); process.exit(1); }
const o = await openSealed(kp, s.sealed, s.sealedSlot, s.openDeadline, (process.env.MEASURE_VIA as any) ?? "relay");
if (!o.ok) { console.log(`seal-to-execute error=${JSON.stringify(o.err)}`); process.exit(1); }
const d = await waitDone(s.sealed.envelope, 120_000);
if (d.state !== "executed") { console.log(`seal-to-execute error=${d.state}`); process.exit(1); }
console.log(`seal-to-execute place=${s.sealed.place} sealed_slot=${s.sealedSlot} executed_slot=${d.executedSlot} filled=${d.consumerOk}`);
console.log(`value=${Date.now() - t0}`);
process.exit(0);
