#!/usr/bin/env node

import { createHash } from 'node:crypto';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RPC = arg('--rpc', process.env.TELL_RPC_URL);
const ENVELOPE = 'jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF', SEALED_POOL = 'D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7';
if (!RPC) { console.log('line-order verdict=FAIL (no --rpc)'); process.exit(2); }
let id = 0;
async function rpc(method, params) {
  for (let t = 0; ; t++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (r.status === 429 && t < 20) { await new Promise((s) => setTimeout(s, 250 * (t + 1))); continue; }
    const j = await r.json(); if (j.error) throw new Error(method + ': ' + JSON.stringify(j.error)); return j.result;
  }
}
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58d = (s) => { let n = 0n; for (const c of s) { const v = A.indexOf(c); if (v < 0) throw new Error('b58'); n = n * 58n + BigInt(v); }
  const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; out.unshift(0); } return Buffer.from(out); };
const b58e = (b) => { let n = 0n; for (const x of b) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x !== 0) break; s = '1' + s; } return s; };
const TAG = Buffer.from('e445a52e51cb9a1d', 'hex');
const disc = (n) => createHash('sha256').update('event:' + n).digest().subarray(0, 8);
const D_EXEC = disc('Executed'), D_SKIP = disc('Skipped'), D_VOID = disc('Voided');
const LINE_DISC = createHash('sha256').update('account:Line').digest().subarray(0, 8);
const tip = await rpc('getSlot', [{ commitment: 'finalized' }]);
const first = await rpc('getFirstAvailableBlock', []);
const from = Math.max(Number(arg('--from', first)), first), to = Math.min(Number(arg('--to', tip)), tip);
const events = [];
for (let a = from; a <= to; a += 500) {
  const slots = await rpc('getBlocks', [a, Math.min(a + 499, to), { commitment: 'finalized' }]);
  for (let i = 0; i < slots.length; i += 8) {
    const blocks = await Promise.all(slots.slice(i, i + 8).map((s) => rpc('getBlock', [s, { encoding: 'json', maxSupportedTransactionVersion: 0, transactionDetails: 'full', rewards: false, commitment: 'finalized' }]).catch(() => null)));
    for (const blk of blocks) {
      if (!blk) continue;
      for (const tx of blk.transactions || []) {
        if (!tx.meta || tx.meta.err) continue;
        const keys = [...tx.transaction.message.accountKeys, ...((tx.meta.loadedAddresses || {}).writable || []), ...((tx.meta.loadedAddresses || {}).readonly || [])];
        const inner = [...(tx.meta.innerInstructions || [])].sort((x, y) => x.index - y.index);
        for (const g of inner) for (const ix of g.instructions) {
          if (keys[ix.programIdIndex] !== ENVELOPE) continue;
          const d = b58d(ix.data); if (d.length < 56 || !d.subarray(0, 8).equals(TAG)) continue;
          const dd = d.subarray(8, 16), kind = dd.equals(D_EXEC) ? 'x' : dd.equals(D_SKIP) ? 's' : dd.equals(D_VOID) ? 'v' : null; if (!kind) continue;
          events.push([b58e(d.subarray(16, 48)), d.readBigUInt64LE(48), kind]);
        }
      }
    }
  }
}
const consumer = new Map();
for (const line of new Set(events.map((e) => e[0]))) {
  const acc = await rpc('getAccountInfo', [line, { encoding: 'base64' }]);
  const b = acc && acc.value ? Buffer.from(acc.value.data[0], 'base64') : null;

  consumer.set(line, b && b.subarray(0, 8).equals(LINE_DISC) ? b58e(b.subarray(40, 72)) : null);
}
const per = new Map(); const next = new Map(); let executed = 0, skipped = 0, voided = 0, out = 0; const lines = new Set();
for (const [line, place, kind] of events) {
  if (consumer.get(line) !== SEALED_POOL) continue;
  lines.add(line);

  const want = next.has(line) ? next.get(line) : place;
  if (place !== want) out++;
  next.set(line, place + 1n);
  if (kind === 'x') executed++; else if (kind === 's') skipped++; else voided++;
  const pl = per.get(line) || { x: 0, s: 0, v: 0 }; pl[kind]++; per.set(line, pl);
}
console.log(`line-order executed=${executed} skipped=${skipped} voided=${voided} lines=${lines.size} out_of_line=${out} slots=${from}-${to}`);
for (const [l, c] of per) console.log(`line-order line=${l} executed=${c.x} skipped=${c.s} voided=${c.v}`);
console.log(`value=${out}`);
