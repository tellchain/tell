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
