import { PublicKey } from "@solana/web3.js";
import { getChain } from "../lib/impl.js";
import bots from "../bots.json" with { type: "json" };

const c = await getChain();
const { sealed: [sp], open: [op] } = await c.pools();
const s = await c.reserves(sp), o = await c.reserves(op);
const out: Record<string, unknown> = { sealed: { ore: String(s.base), test: String(s.quote) }, open: { ore: String(o.base), test: String(o.quote) } };
for (const [k, v] of Object.entries(bots as Record<string, unknown>)) {
  if (k === "note") continue;
  const b = await c.balances(new PublicKey((v as string[])[0]));
  out[k] = { test: String(b.test), ore: String(b.ore), native: String(b.native) };
}
console.log(JSON.stringify(out));
process.exit(0);
