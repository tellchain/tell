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

test("R1: an order that does not fill burns its bond (slippage, cap, bad payload); escrow comes back", async () => {
  const w = await world();
  const u = await user(w);
  const q0 = await bal(u.q);
  const s = await seal(w, u, swapContentFor(w, u, C.SIDE.buy, 1_000_000_000n, 10n ** 15n), 2_000_000_000n);
  await open(u, s);
  await waitSlot(Number(s.deadline) + 1);
  const sig = await executeNext(w);
  const sw = (await events(sig, w.P.sealedPool)).find((x) => x.name === "swapped");
  assert.equal(sw.data.filled, false); assert.equal(sw.data.reason, 1);
  assert.equal(await bal(u.q), q0 - 200_000_000n, "escrow back, bond burned");
  assert.equal((await executedEvent(sig, w)).data.bondReturned.toNumber(), 0);
  const s2 = await seal(w, u, swapContentFor(w, u, C.SIDE.buy, 1_000_000_000n), 500_000_000n);
  await open(u, s2); await waitSlot(Number(s2.deadline) + 1);
  const sig2 = await executeNext(w);
  assert.equal((await events(sig2, w.P.sealedPool)).find((x) => x.name === "swapped").data.reason, 2);
  assert.equal((await executedEvent(sig2, w)).data.bondReturned.toNumber(), 0);
  const junk = C.encodeContent({ program: C.IDS.sealedPool, payload: Buffer.from([9, 9]), escrows: [] });
  const s3 = await seal(w, u, junk, 1_000_000n);
  await open(u, s3); await waitSlot(Number(s3.deadline) + 1);
  const sig3 = await executeNext(w);
  assert.equal((await executedEvent(sig3, w)).data.reason, 3);
  assert.equal((await executedEvent(sig3, w)).data.bondReturned.toNumber(), 0);
});

test("F5 liquidity through envelopes at a place above 0; open pool swaps directly", async () => {
  const w = await world();
  const u = await user(w);
  const s0 = await seal(w, u, swapContentFor(w, u, C.SIDE.buy, 1_000_000n), 1_000_000n);
  await open(u, s0);
  const s = await seal(w, u, C.addLiquidityContent({ base: w.base, quote: w.quote, maxBase: 10_000_000_000n, maxQuote: 10_000_000_000n, minLp: 1n }), 10_000_000_000n);
  assert.ok(s.place > 0n);
  await open(u, s);
  await waitSlot(Number(s.deadline) + 1);
  await executeNext(w);
  const sig = await executeNext(w);
  assert.ok((await events(sig, w.P.sealedPool)).find((x) => x.name === "liquidityAdded").data.filled);
  const lpAta = C.ata(u.k.publicKey, C.lpMintPda(C.IDS.sealedPool, w.sealedPool));
  const lp = await bal(lpAta);
  assert.ok(lp > 0n, "LP to the owner's associated account (created at execute)");
  const s2 = await seal(w, u, C.removeLiquidityContent({ pool: w.sealedPool, lp, minBase: 1n, minQuote: 1n }), 10_000_000_000n);
  await open(u, s2); await waitSlot(Number(s2.deadline) + 1);
  const sig2 = await executeNext(w);
  assert.ok((await events(sig2, w.P.sealedPool)).find((x) => x.name === "liquidityRemoved").data.filled);
  assert.equal(await bal(lpAta), 0n);
  const b0 = await bal(u.b);
  await send([await C.openPoolSwapIx(u.P, { user: u.k.publicKey, pool: w.openPool, base: w.base, quote: w.quote, userBase: u.b, userQuote: u.q, side: 0, amountIn: 1_000_000_000n, minOut: 1n })], [u.k]);
  assert.ok((await bal(u.b)) > b0);
});

test("F8 sealed auction: no bid opens before the close; highest wins, equal later loses (bond back), unopened burns", async () => {
  const w = await world();
  const seller = await user(w);
  const [x, y, z] = [await user(w), await user(w), await user(w)];
  const close = BigInt(await slot()) + 14n;
  const { ix, lot, line } = await C.listLotIx(seller.P, { seller: seller.k.publicKey, lotId: 1n, lotMint: w.base, quote: w.quote, sellerLot: seller.b,
    lotAmount: 5_000_000_000n, reserve: 1_000_000_000n, closeSlot: close, revealWindow: 8 });
  await send([ix], [seller.k]);
  const bid = (amount) => C.bidContent({ quote: w.quote, amount });
  const sx = await seal(w, x, bid(3_000_000_000n), 5_000_000_000n, line);
  const sy = await seal(w, y, bid(3_000_000_000n), 5_000_000_000n, line);
  const sz = await seal(w, z, bid(4_000_000_000n), 5_000_000_000n, line);
  await waitSlot(Number(sx.sealedSlot) + 1);
  await expectFail(send([await C.openIx(x.P, { owner: x.k.publicKey, line, place: sx.place, content: sx.content, secret: sx.secret })], [x.k]), /WindowNotOpen/);
  assert.equal(sx.deadline, close + 8n, "the window starts at the close");
  await waitSlot(Number(close) + 1);
  const late = await user(w);
  await expectFail(seal(w, late, bid(9_000_000_000n), 9_000_000_000n, line), /SealingClosed/);
  await open(x, sx); await open(y, sy);
  const yq0 = await bal(y.q);
  const sigs = await executeAll(w, line);
  assert.equal(sigs.length, 3);
  assert.equal(await bal(y.q), yq0 + 3_000_000_000n + 500_000_000n, "outbid: escrow and bond back");
  const L = await w.P.sealedAuction.account.lot.fetch(lot);
  assert.ok(L.bestBidder.equals(x.k.publicKey), "the earlier of two equal bids wins");
  await waitSlot(Number(close) + 9);
  const lb0 = await bal(x.b), sq0 = await bal(seller.q);
  await send([await C.settleIx(w.P, { payer: w.reg.publicKey, lot })], [w.reg]);
  assert.equal(await bal(x.b), lb0 + 5_000_000_000n);
  assert.equal(await bal(seller.q), sq0 + 3_000_000_000n);
  assert.equal((await w.P.envelope.account.envelope.fetch(sz.envelope)).state, C.STATE.skipped);
});
