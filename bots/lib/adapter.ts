import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { conn } from "./rpc.js";
import { BOTS_DIR } from "./config.js";
import type { Chain, EnvelopeView, Reserves, Side, SwapContent } from "./chain.js";

export const IDS = {
  envelope: new PublicKey("jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF"),
  sealedPool: new PublicKey("D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7"),
  openPool: new PublicKey("HxzVrsgrfeYXmdjT5cxsZBaj6z4WdQMqQjTp8Z7EN957"),
  sealedAuction: new PublicKey("CWvRXgP4d9QGZFEt1DBEBnpECtUEW5F1hRD1QKbZ5YMH"),
  test: new PublicKey(process.env.TELL_TEST_MINT ?? "AHRZr9db6z1Be3PChiU8YaPqNaS5hC9rg1NLMWCALoch"),
  ore: new PublicKey(process.env.TELL_BASE_MINT ?? process.env.TELL_ORE_MINT ?? "E7wnZq3vwWUgkvHcuqQ3g2R1YhRDAZ6vfAUzUmXXmksA"),
};

const idl = (n: string) => JSON.parse(readFileSync(join(process.env.TELL_IDL_DIR ?? join(BOTS_DIR, "..", "idl"), `${n}.json`), "utf8")) as Idl;
const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), { commitment: "confirmed" });
const P = {
  envelope: new Program(idl("envelope"), provider),
  sealedPool: new Program(idl("sealed_pool"), provider),
  openPool: new Program(idl("open_pool"), provider),
  sealedAuction: new Program(idl("sealed_auction"), provider),
};

const pda = (seeds: (Buffer | Uint8Array)[], prog: PublicKey) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const u64le = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const lineOf = (market: PublicKey) => pda([Buffer.from("line"), market.toBuffer()], IDS.envelope);
export const envelopeOf = (line: PublicKey, place: number) => pda([Buffer.from("envelope"), line.toBuffer(), u64le(place)], IDS.envelope);
const authorityOf = (line: PublicKey) => pda([Buffer.from("authority"), line.toBuffer()], IDS.envelope);
export const envelopeEventAuthority = pda([Buffer.from("__event_authority")], IDS.envelope);
const EVT = { eventAuthority: envelopeEventAuthority, program: IDS.envelope };
export { authorityOf, bondVaultOf };
const bondVaultOf = (line: PublicKey) => pda([Buffer.from("bond_vault"), line.toBuffer()], IDS.envelope);
const escrowOf = (env: PublicKey, i: number) => pda([Buffer.from("escrow"), env.toBuffer(), Buffer.from([i])], IDS.envelope);
export const poolOf = (prog: PublicKey, base: PublicKey, quote: PublicKey) => pda([Buffer.from("pool"), base.toBuffer(), quote.toBuffer()], prog);
const vaultOf = (prog: PublicKey, pool: PublicKey, mint: PublicKey) => pda([Buffer.from("vault"), pool.toBuffer(), mint.toBuffer()], prog);
const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

type EscrowSpec = { mint: PublicKey; amount: bigint };
type Content = { program: PublicKey; payload: Buffer; escrows: EscrowSpec[] };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export function encodeContent(c: Content): Buffer {
  return Buffer.concat([
    Buffer.from([1]), c.program.toBuffer(),
    u32le(c.payload.length), c.payload,
    u32le(c.escrows.length), ...c.escrows.map((e) => Buffer.concat([e.mint.toBuffer(), u64le(e.amount)])),
  ]);
}
export function decodeContent(b: Buffer): Content {
  let o = 1;
  const pk = () => { const k = new PublicKey(b.subarray(o, o + 32)); o += 32; return k; };
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const program = pk();
  const pl = u32(); const payload = Buffer.from(b.subarray(o, o + pl)); o += pl;
  const escrows: EscrowSpec[] = []; for (let n = u32(); n > 0; n--) { const mint = pk(); const amount = b.readBigUInt64LE(o); o += 8; escrows.push({ mint, amount }); }
  return { program, payload, escrows };
}

function sealedSwapContent(_owner: PublicKey, c: SwapContent): Content {
  const side = c.side === "buy" ? 0 : 1;
  return {
    program: IDS.sealedPool,
    payload: Buffer.concat([Buffer.from([0, side]), u64le(c.amountIn), u64le(c.minOut)]),
    escrows: [{ mint: c.side === "buy" ? IDS.test : IDS.ore, amount: c.amountIn }],
  };
}

const W = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const R = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
async function consumerAccounts(l: any, owner: PublicKey) {
  if (l.consumer.equals(IDS.sealedPool)) {
    const pool: any = await (P.sealedPool.account as any).pool.fetch(l.market);
    return [W(l.market), W(pool.baseVault), W(pool.quoteVault), W(pool.lpMint), R(pool.baseMint), R(pool.quoteMint), R(owner),
      W(ata(owner, pool.baseMint)), W(ata(owner, pool.quoteMint)), W(ata(owner, pool.lpMint)), R(TOKEN_PROGRAM_ID), R(ASSOCIATED_TOKEN_PROGRAM_ID), R(SystemProgram.programId)];
  }
  if (l.consumer.equals(IDS.sealedAuction)) {
    const lot: any = await (P.sealedAuction.account as any).lot.fetch(l.market);
    return [W(l.market), W(lot.bidVault), R(lot.quoteMint), R(owner), W(ata(owner, lot.quoteMint)), R(lot.bestBidder), W(ata(lot.bestBidder, lot.quoteMint)),
      R(TOKEN_PROGRAM_ID), R(ASSOCIATED_TOKEN_PROGRAM_ID), R(SystemProgram.programId)];
  }
  throw new Error("unknown consumer " + l.consumer.toBase58());
}

export function fingerprintOf(line: PublicKey, owner: PublicKey, content: Buffer, secret: Uint8Array): Uint8Array {
  return createHash("sha256").update(Buffer.from("blindfold:v1")).update(line.toBuffer()).update(owner.toBuffer())
    .update(u32le(content.length)).update(content).update(secret).digest();
}

const STATES = ["sealed", "opened", "executed", "skipped", "voided"] as const;
let lineCache: { at: number; keys: PublicKey[] } | null = null;
const n = (x: any) => BigInt(x.toString());

const chain: Chain = {
  async pools() {
    const sealed = poolOf(IDS.sealedPool, IDS.ore, IDS.test);
    const open = poolOf(IDS.openPool, IDS.ore, IDS.test);
    return { sealed: [sealed], open: [open], pairOf: (p) => (p.equals(sealed) ? open : p.equals(open) ? sealed : null) };
  },
  async openWindowSlots() {
    const l: any = await (P.envelope.account as any).line.fetch(lineOf(poolOf(IDS.sealedPool, IDS.ore, IDS.test)));
    return Number(l.openWindow);
  },
  async bondFor(cap) {
    const l: any = await (P.envelope.account as any).line.fetch(lineOf(poolOf(IDS.sealedPool, IDS.ore, IDS.test)));
    const b = (cap * BigInt(l.bondBps) + 9_999n) / 10_000n;
    const min = BigInt(l.minBond.toString());
    return b < min ? min : b;
  },
  async dueBatches(currentSlot) {
    if (!lineCache || Date.now() - lineCache.at > 30_000) lineCache = { at: Date.now(), keys: ((await (P.envelope.account as any).line.all()) as any[]).map((x) => x.publicKey) };
    const datas: any[] = await (P.envelope.account as any).line.fetchMultiple(lineCache.keys);
    const lines = lineCache.keys.map((publicKey: PublicKey, i: number) => ({ publicKey, account: datas[i] })).filter((x: any) => x.account);
    const out: { line: PublicKey; places: number[] }[] = [];
    for (const { publicKey, account } of lines) {
      const next = Number(account.nextExecute), end = Number(account.nextPlace);
      const places: number[] = [];
      for (let p = next; p < end && places.length < 16; p++) {
        const e: any = await (P.envelope.account as any).envelope.fetchNullable(envelopeOf(publicKey, p));
        if (!e || Number(e.openDeadline) >= currentSlot) break;
        places.push(p);
      }
      if (places.length) out.push({ line: publicKey, places });
    }
    return out;
  },
  async buildExecute(payer, line, places) {
    const l: any = await (P.envelope.account as any).line.fetch(line);
    const txs: TransactionInstruction[][] = [];
    let cur: TransactionInstruction[] = [];
    let curAccts = 0;
    for (const place of places) {
      const envPk = envelopeOf(line, place);
      const e: any = await (P.envelope.account as any).envelope.fetch(envPk);
      const rem: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      if (e.state === 1) {
        const c = decodeContent(Buffer.from(e.content));
        c.escrows.forEach((s, i) => rem.push(W(escrowOf(envPk, i)), W(ata(e.owner, s.mint)), R(s.mint)));
        rem.push(...(await consumerAccounts(l, e.owner)));
      }
      const ix = await P.envelope.methods.execute().accountsPartial({
        cranker: payer, line, envelope: envPk, owner: e.owner, bondSource: e.bondSource, bondVault: l.bondVault,
        bondMint: l.bondMint, envelopeAuthority: authorityOf(line), consumerProgram: l.consumer, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, ...EVT,
      }).remainingAccounts(rem).instruction();
      const cost = ix.keys.length;
      const perTx = l.consumer.equals(IDS.sealedAuction) ? 1 : 4;
      if (cur.length && (curAccts + cost > 48 || cur.length >= perTx)) { txs.push(cur); cur = []; curAccts = 0; }
      cur.push(ix); curAccts += cost;
    }
    if (cur.length) txs.push(cur);
    return txs;
  },
  async staleLines(currentSlot) {
    if (!lineCache) return [];
    const datas: any[] = await (P.envelope.account as any).line.fetchMultiple(lineCache.keys);
    const out: PublicKey[] = [];
    for (let i = 0; i < lineCache.keys.length; i++) {
      const l = datas[i];
      if (!l || Number(l.nextExecute) >= Number(l.nextPlace)) continue;
      const e: any = await (P.envelope.account as any).envelope.fetchNullable(envelopeOf(lineCache.keys[i], Number(l.nextExecute)));
      if (!e) continue;
      const from = Math.max(Number(e.openDeadline), Number(l.cursorMovedSlot ?? 0));
      if (currentSlot > from + Number(l.staleSlots)) out.push(lineCache.keys[i]);
    }
    return out;
  },
  async buildVoidStale(payer, line) {
    const l: any = await (P.envelope.account as any).line.fetch(line);
    return [await P.envelope.methods.voidStale().accountsPartial({ cranker: payer, line, envelope: envelopeOf(line, Number(l.nextExecute)),
      bondVault: l.bondVault, bondMint: l.bondMint, envelopeAuthority: authorityOf(line), tokenProgram: TOKEN_PROGRAM_ID, ...EVT }).instruction()];
  },
  async envelope(line, place) {
    const e: any = await (P.envelope.account as any).envelope.fetchNullable(envelopeOf(line, place));
    if (!e) return null;
    return { place, owner: e.owner.toBase58(), state: STATES[e.state], sealedSlot: Number(e.sealedSlot),
      fingerprint: Buffer.from(e.fingerprint).toString("hex"), cap: n(e.cap), bond: n(e.bond) } satisfies EnvelopeView;
  },
  newSecret: () => randomBytes(32),
  fingerprint(c, secret) { throw new Error("use sealOrder(): the fingerprint needs line and owner"); },
  async buildSeal() { throw new Error("use sealOrder()"); },
  async placeOfSeal(sig) {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const m = tx?.meta?.logMessages?.join("\n") ?? "";
    const hit = /place[=: ]+(\d+)/i.exec(m);
    if (!hit) throw new Error("place not readable from seal logs; read the envelope instead");
    return Number(hit[1]);
  },
  async buildOpen() { throw new Error("use openOrder()"); },
  async reserves(pool) {
    if (pool.equals(poolOf(IDS.sealedPool, IDS.ore, IDS.test))) {
      const p: any = await (P.sealedPool.account as any).pool.fetch(pool);
      if (p.reserveBase !== undefined) return { base: n(p.reserveBase), quote: n(p.reserveQuote), feeBps: Number(p.feeBps) } satisfies Reserves;
      const [b, q] = await Promise.all([
        conn.getTokenAccountBalance(vaultOf(IDS.sealedPool, pool, IDS.ore)), conn.getTokenAccountBalance(vaultOf(IDS.sealedPool, pool, IDS.test)),
      ]);
      return { base: BigInt(b.value.amount), quote: BigInt(q.value.amount), feeBps: 25 } satisfies Reserves;
    }
    const [b, q] = await Promise.all([
      conn.getTokenAccountBalance(vaultOf(IDS.openPool, pool, IDS.ore)), conn.getTokenAccountBalance(vaultOf(IDS.openPool, pool, IDS.test)),
    ]);
    return { base: BigInt(b.value.amount), quote: BigInt(q.value.amount), feeBps: 25 } satisfies Reserves;
  },
  async buildOpenSwap(owner, c) {
    const pool = c.pool;
    return [
      createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ata(owner.publicKey, IDS.ore), owner.publicKey, IDS.ore),
      await P.openPool.methods.swap(c.side === "buy" ? 0 : 1, new BN(c.amountIn.toString()), new BN(c.minOut.toString())).accountsPartial({
        user: owner.publicKey, pool, baseVault: vaultOf(IDS.openPool, pool, IDS.ore), quoteVault: vaultOf(IDS.openPool, pool, IDS.test),
        userBase: ata(owner.publicKey, IDS.ore), userQuote: ata(owner.publicKey, IDS.test), tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction(),
    ];
  },
  async buildOpenLiquidity(owner, pool, action, base, quote) {
    const lpMint = ((await (P.openPool.account as any).pool.fetch(pool)) as any).lpMint as PublicKey;
    const accts = { user: owner.publicKey, pool, baseVault: vaultOf(IDS.openPool, pool, IDS.ore), quoteVault: vaultOf(IDS.openPool, pool, IDS.test),
      lpMint, userBase: ata(owner.publicKey, IDS.ore), userQuote: ata(owner.publicKey, IDS.test), userLp: ata(owner.publicKey, lpMint), tokenProgram: TOKEN_PROGRAM_ID };
    const pre = createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, accts.userLp, owner.publicKey, lpMint);
    if (action === "add") return [pre, await P.openPool.methods.addLiquidity(new BN(base.toString()), new BN(quote.toString()), new BN(0)).accountsPartial(accts).instruction()];
    throw new Error("remove on the open pool: lp amount path not used by bot-lp");
  },
  async balances(owner) {
    const get = async (m: PublicKey) => { try { return BigInt((await conn.getTokenAccountBalance(ata(owner, m))).value.amount); } catch { return 0n; } };
    const [test, ore, native] = await Promise.all([get(IDS.test), get(IDS.ore), conn.getBalance(owner)]);
    return { test, ore, native: BigInt(native) };
  },
  async received(sig, owner, side) {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return null;
    const mint = (side === "buy" ? IDS.ore : IDS.test).toBase58();
    const o = owner.toBase58();
    const amt = (l: any[] | null | undefined) => BigInt(l?.find((b) => b.owner === o && b.mint === mint)?.uiTokenAmount.amount ?? "0");
    return amt(tx.meta.postTokenBalances) - amt(tx.meta.preTokenBalances);
  },
};

export type Sealed = { line: PublicKey; place: number; envelope: PublicKey; content: Buffer; secret: Uint8Array; fingerprint: Uint8Array; cap: bigint; openWindow?: number };
export async function sealIxs(owner: Keypair, c: SwapContent, cap?: bigint, placeOffset = 0) {
  const line = lineOf(c.pool);
  const l: any = await (P.envelope.account as any).line.fetch(line);
  const place = Number(l.nextPlace) + placeOffset;
  const content = encodeContent(sealedSwapContent(owner.publicKey, c));
  const secret = randomBytes(32);
  const fp = fingerprintOf(line, owner.publicKey, content, secret);
  const capV = cap ?? (c.side === "buy" ? c.amountIn : c.minOut * 2n);
  const envelope = envelopeOf(line, place);
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ata(owner.publicKey, IDS.ore), owner.publicKey, IDS.ore),
    await P.envelope.methods.seal([...fp], new BN(capV.toString())).accountsPartial({
      owner: owner.publicKey, line, envelope, bondSource: ata(owner.publicKey, IDS.test), bondVault: bondVaultOf(line), bondMint: IDS.test,
      tokenProgram: TOKEN_PROGRAM_ID, ...EVT,
    }).instruction(),
  ];
  return { ixs, sealed: { line, place, envelope, content, secret, fingerprint: fp, cap: capV, openWindow: Number(l.openWindow) } satisfies Sealed };
}
export async function sealLiquidityIxs(owner: Keypair, pool: PublicKey, base: bigint, quote: bigint) {
  const line = lineOf(pool);
  const l: any = await (P.envelope.account as any).line.fetch(line);
  const place = Number(l.nextPlace);
  const lpMint = pda([Buffer.from("lp"), pool.toBuffer()], IDS.sealedPool);
  const c: Content = {
    program: IDS.sealedPool,
    payload: Buffer.concat([Buffer.from([1]), u64le(base), u64le(quote), u64le(0)]),
    escrows: [{ mint: IDS.ore, amount: base }, { mint: IDS.test, amount: quote }],
  };
  const content = encodeContent(c);
  const secret = randomBytes(32);
  const fp = fingerprintOf(line, owner.publicKey, content, secret);
  const envelope = envelopeOf(line, place);
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ata(owner.publicKey, lpMint), owner.publicKey, lpMint),
    await P.envelope.methods.seal([...fp], new BN(quote.toString())).accountsPartial({
      owner: owner.publicKey, line, envelope, bondSource: ata(owner.publicKey, IDS.test), bondVault: bondVaultOf(line), bondMint: IDS.test, tokenProgram: TOKEN_PROGRAM_ID, ...EVT,
    }).instruction(),
  ];
  return { ixs, sealed: { line, place, envelope, content, secret, fingerprint: fp, cap: quote } satisfies Sealed };
}
export async function openIxs(owner: Keypair, s: Sealed) {
  const c = decodeContent(s.content);
  const prev = s.line;
  const rem = c.escrows.flatMap((e, i) => [R(e.mint), W(ata(owner.publicKey, e.mint)), W(escrowOf(s.envelope, i))]);
  return [await P.envelope.methods.open(s.content, [...s.secret]).accountsPartial({
    owner: owner.publicKey, line: s.line, envelope: s.envelope, prevEnvelope: prev, envelopeAuthority: authorityOf(s.line), tokenProgram: TOKEN_PROGRAM_ID, ...EVT,
  }).remainingAccounts(rem).instruction()];
}
export async function envelopeRaw(env: PublicKey) { return (P.envelope.account as any).envelope.fetchNullable(env); }
export { P };
export default chain;
