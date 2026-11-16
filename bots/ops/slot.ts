import { conn } from "../lib/rpc.js";
const s = await conn.getSlot("confirmed");
const t = await conn.getBlockTime(s).catch(() => null);
console.log(JSON.stringify({ slot: s, blockTime: t ? new Date(t * 1000).toISOString() : null }));
process.exit(0);
