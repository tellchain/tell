import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RECORD_DIR } from "../lib/config.js";

const name = process.argv[2];
const si = process.argv.indexOf("--since");
const since = si > 0 ? Date.parse(process.argv[si + 1]) : 0;
const f = join(RECORD_DIR, "sandwich.jsonl");
const rows = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const pick = rows.filter((r) => Date.parse(r.at) >= since && r.result !== "skipped" && r.takenTestUnits !== undefined).filter((r) =>
  name === "sandwich-open-pool" ? r.pool === "open" : name === "sandwich-sealed-pool" ? r.pool === "sealed" : name === "unopened-attack" ? r.strategy === "unopened-both-sides" : false);
if (!["sandwich-open-pool", "sandwich-sealed-pool", "unopened-attack"].includes(name)) { console.log("usage: tally.ts sandwich-open-pool|sandwich-sealed-pool|unopened-attack [--since ISO]"); process.exit(2); }
if (pick.length === 0) { console.log(`${name} attempts=0 error=no-records`); process.exit(1); }
const taken = pick.reduce((a, r) => a + BigInt(r.takenTestUnits ?? "0"), 0n);
const bonds = pick.reduce((a, r) => a + BigInt(r.bondsLostTestUnits ?? "0"), 0n);
const cut = pick.filter((r) => r.result === "cut-in").length;
const fmt = (v: bigint) => { const neg = v < 0n; const a = neg ? -v : v; return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`; };
const sampling = name === "sandwich-open-pool" ? "" : ` sampling="${pick.find((r) => r.sampling)?.sampling ?? "none"}"`;
console.log(`${name} attempts=${pick.length}${sampling} cut_ins=${cut} taken_test=${fmt(taken)} bonds_lost_test=${fmt(bonds)} from=${pick[0].at} to=${pick.at(-1).at}`);
console.log(`value=${fmt(taken)}`);
