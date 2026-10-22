import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as C from "../client/index.js";
import * as H from "./setup.js";
import { conn, world, user, seal, open, executeNext, executeAll, swapContentFor, bal, supply, send, waitSlot, events, slot } from "./setup.js";

const expectFail = async (p, re) => {
  try { await p; } catch (e) { const s = String(e) + JSON.stringify(e.logs ?? e.transactionLogs ?? ""); assert.match(s, re); return; }
  assert.fail("expected failure " + re);
};
const executedEvent = async (sig, w) => (await events(sig, w.P.envelope)).find((x) => x.name === "executed");

test("F1 seal, open, execute in place order through the sealed pool; the bond returns on a fill", async () => {
  const w = await world();
  const u = await user(w);
  const q0 = await bal(u.q), b0 = await bal(u.b);
  const content = swapContentFor(w, u, C.SIDE.buy, 1_000_000_000n, 1n);
  const s = await seal(w, u, content, 2_000_000_000n);
  assert.equal(s.place, 0n);
  const e0 = await w.P.envelope.account.envelope.fetch(s.envelope);
  assert.equal(e0.state, C.STATE.sealed);
  assert.equal(Buffer.from(e0.content).length, 0, "nothing but the fingerprint before open");
  assert.equal(e0.bond.toString(), "200000000");
  const stx = await conn.getTransaction(s.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.ok(!JSON.stringify(stx).includes(w.sealedPool.toBase58()), "the seal names no pool");
  await open(u, s);
  assert.deepEqual(Buffer.from((await w.P.envelope.account.envelope.fetch(s.envelope)).content), content);
  await expectFail(executeNext(w), /WindowNotOver/);
  await waitSlot(Number(s.deadline) + 1);
  const sig = await executeNext(w);
  assert.equal((await w.P.envelope.account.envelope.fetch(s.envelope)).state, C.STATE.executed);
  assert.equal(await bal(u.q), q0 - 1_000_000_000n, "input spent, bond back");
  assert.ok((await bal(u.b)) > b0, "ORE received");
  const ex = await executedEvent(sig, w);
  assert.ok(ex.data.filled && ex.data.bondReturned.toString() === "200000000");
});

test("F4 sealed and never opened: skipped at execute, bond burned", async () => {
  const w = await world();
  const u = await user(w);
  const sup0 = await supply(w.quote);
  const s = await seal(w, u, swapContentFor(w, u, C.SIDE.sell, 500_000_000n), 1_000_000_000n);
  await waitSlot(Number(s.deadline) + 1);
  await expectFail(open(u, s), /WindowClosed/);
  const sig = await executeNext(w);
  assert.equal((await w.P.envelope.account.envelope.fetch(s.envelope)).state, C.STATE.skipped);
  assert.equal(await supply(w.quote), sup0 - 100_000_000n, "bond burned");
  assert.ok((await events(sig, w.P.envelope)).find((x) => x.name === "skipped"));
});

test("execution follows the line; wrong secret refused; no outside entry; a cranker's wrong account is an error a retry cures", async () => {
  const w = await world();
  const a = await user(w), b = await user(w);
  const sa = await seal(w, a, swapContentFor(w, a, C.SIDE.buy, 100_000_000n), 100_000_000n);
  const sb = await seal(w, b, swapContentFor(w, b, C.SIDE.buy, 100_000_000n), 100_000_000n);
  assert.equal(sb.place, sa.place + 1n);
  await waitSlot(Number(sa.sealedSlot) + 1);
  await expectFail(open(a, { ...sa, secret: C.randomSecret() }), /FingerprintMismatch/);
  await open(a, sa); await open(b, sb);
  await waitSlot(Number(sb.deadline) + 1);
  await expectFail(send([await C.executeIx(w.P, { cranker: w.reg.publicKey, line: w.line, place: sb.place })], [w.reg]), /NotNextInLine/);
  const fake = await w.P.sealedPool.methods.onEnvelope(a.k.publicKey, new anchor.BN(0), new anchor.BN(1), Buffer.from([0]))
    .accountsPartial({ envelopeAuthority: a.k.publicKey, envelope: sa.envelope, line: w.line, cranker: a.k.publicKey }).instruction();
  await expectFail(send([fake], [a.k]), /NotEnvelope|Error/);

  const ix = await C.executeIx(w.P, { cranker: w.reg.publicKey, line: w.line });
  const pool = await w.P.sealedPool.account.pool.fetch(w.sealedPool);
  const bad1 = { ...ix, keys: ix.keys.map((k) => k.pubkey.equals(pool.baseVault) ? { ...k, pubkey: pool.quoteVault } : k) };
  await expectFail(send([bad1], [w.reg]), /AccountMismatch/);
  const bad2 = { ...ix, keys: ix.keys.map((k) => k.pubkey.equals(C.ata(a.k.publicKey, w.base)) ? { ...k, isWritable: false } : k) };
  await expectFail(send([bad2], [w.reg]), /AccountMismatch/);
  assert.equal((await w.P.envelope.account.line.fetch(w.line)).nextExecute.toNumber(), 0);
  assert.equal((await executeAll(w)).length, 2, "a stock crank executes both");
});
