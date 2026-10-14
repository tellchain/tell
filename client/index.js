import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import envelopeIdl from "../idl/envelope.json" with { type: "json" };
import sealedPoolIdl from "../idl/sealed_pool.json" with { type: "json" };
import openPoolIdl from "../idl/open_pool.json" with { type: "json" };
import sealedAuctionIdl from "../idl/sealed_auction.json" with { type: "json" };

export const IDS = {
  envelope: new PublicKey("jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF"),
  sealedPool: new PublicKey("D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7"),
  openPool: new PublicKey("HxzVrsgrfeYXmdjT5cxsZBaj6z4WdQMqQjTp8Z7EN957"),
  sealedAuction: new PublicKey("CWvRXgP4d9QGZFEt1DBEBnpECtUEW5F1hRD1QKbZ5YMH"),
};
export const MINTS = {
  TEST: new PublicKey("AHRZr9db6z1Be3PChiU8YaPqNaS5hC9rg1NLMWCALoch"),
  ORE: new PublicKey("E7wnZq3vwWUgkvHcuqQ3g2R1YhRDAZ6vfAUzUmXXmksA"),
  SLAB: new PublicKey("AgFdsoH2zBJPy1joQ3FnEU2iGANSzT8tHZMLMpsrBfXU"),
};
export const IDLS = { envelope: envelopeIdl, sealedPool: sealedPoolIdl, openPool: openPoolIdl, sealedAuction: sealedAuctionIdl };
export const DOMAIN = new TextEncoder().encode("blindfold:v1");
export const STATE = { sealed: 0, opened: 1, executed: 2, skipped: 3 };
export const SIDE = { buy: 0, sell: 1 };

const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds, program)[0];

export const authorityPda = (line) => pda([Buffer.from("authority"), line.toBuffer()], IDS.envelope);
export const eventAuthority = (program) => pda([Buffer.from("__event_authority")], program);
export const linePda = (market) => pda([Buffer.from("line"), market.toBuffer()], IDS.envelope);
export const envelopePda = (line, place) => pda([Buffer.from("envelope"), line.toBuffer(), u64le(place)], IDS.envelope);
export const bondVaultPda = (line) => pda([Buffer.from("bond_vault"), line.toBuffer()], IDS.envelope);
export const escrowPda = (envelope, i) => pda([Buffer.from("escrow"), envelope.toBuffer(), Buffer.from([i])], IDS.envelope);
export const poolPda = (program, base, quote) => pda([Buffer.from("pool"), base.toBuffer(), quote.toBuffer()], program);
export const vaultPda = (program, pool, mint) => pda([Buffer.from("vault"), pool.toBuffer(), mint.toBuffer()], program);
export const lpMintPda = (program, pool) => pda([Buffer.from("lp"), pool.toBuffer()], program);
export const configPda = (program) => pda([Buffer.from("config")], program);
export const lotPda = (seller, lotId) => pda([Buffer.from("lot"), seller.toBuffer(), u64le(lotId)], IDS.sealedAuction);
export const lotVaultPda = (lot) => pda([Buffer.from("lot_vault"), lot.toBuffer()], IDS.sealedAuction);
export const bidVaultPda = (lot) => pda([Buffer.from("bid_vault"), lot.toBuffer()], IDS.sealedAuction);

export function encodeContent({ program, payload, escrows = [] }) {
  const parts = [Buffer.from([1]), program.toBuffer(), u32le(payload.length), Buffer.from(payload), u32le(escrows.length)];
  for (const e of escrows) parts.push(e.mint.toBuffer(), u64le(e.amount));
  return Buffer.concat(parts);
}

export function decodeContent(bytes) {
  const b = Buffer.from(bytes); let o = 0;
  const version = b[o]; o += 1;
  const program = new PublicKey(b.subarray(o, o + 32)); o += 32;
  const pl = b.readUInt32LE(o); o += 4; const payload = b.subarray(o, o + pl); o += pl;
  const ne = b.readUInt32LE(o); o += 4; const escrows = [];
  for (let i = 0; i < ne; i++) { escrows.push({ mint: new PublicKey(b.subarray(o, o + 32)), amount: b.readBigUInt64LE(o + 32) }); o += 40; }
  return { version, program, payload: Buffer.from(payload), escrows };
}

export function fingerprint(line, owner, content, secret) {
  return Buffer.from(sha256(Buffer.concat([Buffer.from(DOMAIN), line.toBuffer(), owner.toBuffer(), u32le(content.length), Buffer.from(content), Buffer.from(secret)])));
}

export const ata = (owner, mint) => getAssociatedTokenAddressSync(mint, owner, true);

export const swapPayload = (side, amountIn, minOut) => Buffer.concat([Buffer.from([0, side]), u64le(amountIn), u64le(minOut)]);
export const addLiquidityPayload = (maxBase, maxQuote, minLp) => Buffer.concat([Buffer.from([1]), u64le(maxBase), u64le(maxQuote), u64le(minLp)]);
export const removeLiquidityPayload = (lp, minBase, minQuote) => Buffer.concat([Buffer.from([2]), u64le(lp), u64le(minBase), u64le(minQuote)]);
export const bidPayload = (amount) => Buffer.concat([Buffer.from([0]), u64le(amount)]);

export const swapContent = ({ base, quote, side, amountIn, minOut }) => encodeContent({
  program: IDS.sealedPool, payload: swapPayload(side, amountIn, minOut), escrows: [{ mint: side === 0 ? quote : base, amount: amountIn }] });
export const addLiquidityContent = ({ base, quote, maxBase, maxQuote, minLp }) => encodeContent({
  program: IDS.sealedPool, payload: addLiquidityPayload(maxBase, maxQuote, minLp), escrows: [{ mint: base, amount: maxBase }, { mint: quote, amount: maxQuote }] });
export const removeLiquidityContent = ({ pool, lp, minBase, minQuote }) => encodeContent({
  program: IDS.sealedPool, payload: removeLiquidityPayload(lp, minBase, minQuote), escrows: [{ mint: lpMintPda(IDS.sealedPool, pool), amount: lp }] });
export const bidContent = ({ quote, amount }) => encodeContent({ program: IDS.sealedAuction, payload: bidPayload(amount), escrows: [{ mint: quote, amount }] });

export function programs(provider) {
  return {
    envelope: new anchor.Program(envelopeIdl, provider),
    sealedPool: new anchor.Program(sealedPoolIdl, provider),
    openPool: new anchor.Program(openPoolIdl, provider),
    sealedAuction: new anchor.Program(sealedAuctionIdl, provider),
  };
}

export const randomSecret = () => { const s = new Uint8Array(32); globalThis.crypto.getRandomValues(s); return Buffer.from(s); };

export async function sealIx(P, { owner, line, content, secret, cap }) {
  const l = await P.envelope.account.line.fetch(line);
  const place = BigInt(l.nextPlace.toString());
  const envelope = envelopePda(line, place);
  const fp = fingerprint(line, owner, content, secret);
  const ix = await P.envelope.methods.seal([...fp], new anchor.BN(cap.toString()))
    .accountsPartial({ owner, line, envelope, bondSource: ata(owner, l.bondMint), bondVault: l.bondVault, bondMint: l.bondMint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
  return { ix, envelope, place, fingerprint: fp };
}

export async function openIx(P, { owner, line, place, content, secret }) {
  const envelope = envelopePda(line, place);
  const l = await P.envelope.account.line.fetch(line);

  const prev = l.orderedOpen && place > 0n ? envelopePda(line, place - 1n) : line;
  const c = decodeContent(content);
  const rem = [];
  c.escrows.forEach((e, i) => rem.push(
    { pubkey: e.mint, isSigner: false, isWritable: false },
    { pubkey: ata(owner, e.mint), isSigner: false, isWritable: true },
    { pubkey: escrowPda(envelope, i), isSigner: false, isWritable: true }));
  return P.envelope.methods.open(Buffer.from(content), [...secret])
    .accountsPartial({ owner, line, envelope, prevEnvelope: prev, envelopeAuthority: authorityPda(line), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .remainingAccounts(rem).instruction();
}

const W = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const R = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });

export async function consumerAccounts(P, l, owner) {
  if (l.consumer.equals(IDS.sealedPool)) {
    const pool = await P.sealedPool.account.pool.fetch(l.market);
    return [W(l.market), W(pool.baseVault), W(pool.quoteVault), W(pool.lpMint), R(pool.baseMint), R(pool.quoteMint), R(owner),
      W(ata(owner, pool.baseMint)), W(ata(owner, pool.quoteMint)), W(ata(owner, pool.lpMint)), R(TOKEN_PROGRAM_ID), R(ASSOCIATED_TOKEN_PROGRAM_ID), R(SystemProgram.programId)];
  }
  if (l.consumer.equals(IDS.sealedAuction)) {
    const lot = await P.sealedAuction.account.lot.fetch(l.market);
    return [W(l.market), W(lot.bidVault), R(lot.quoteMint), R(owner), W(ata(owner, lot.quoteMint)), R(lot.bestBidder), W(ata(lot.bestBidder, lot.quoteMint)),
      R(TOKEN_PROGRAM_ID), R(ASSOCIATED_TOKEN_PROGRAM_ID), R(SystemProgram.programId)];
  }
  throw new Error("unknown consumer " + l.consumer.toBase58());
}

export async function executeIx(P, { cranker, line, place }) {
  const l = await P.envelope.account.line.fetch(line);
  const pl = place ?? BigInt(l.nextExecute.toString());
  const envelope = envelopePda(line, pl);
  const e = await P.envelope.account.envelope.fetch(envelope);
  const rem = [];
  if (e.state === STATE.opened) {
    const c = decodeContent(Buffer.from(e.content));
    c.escrows.forEach((s, i) => rem.push(W(escrowPda(envelope, i)), W(ata(e.owner, s.mint)), R(s.mint)));
    rem.push(...(await consumerAccounts(P, l, e.owner)));
  }
  return P.envelope.methods.execute()
    .accountsPartial({ cranker, line, envelope, owner: e.owner, bondSource: e.bondSource, bondVault: l.bondVault, bondMint: l.bondMint,
      envelopeAuthority: authorityPda(line), consumerProgram: l.consumer, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .remainingAccounts(rem).instruction();
}

export async function voidStaleIx(P, { cranker, line }) {
  const l = await P.envelope.account.line.fetch(line);
  const envelope = envelopePda(line, BigInt(l.nextExecute.toString()));
  return P.envelope.methods.voidStale().accountsPartial({ cranker, line, envelope, bondVault: l.bondVault, bondMint: l.bondMint,
    envelopeAuthority: authorityPda(line), tokenProgram: TOKEN_PROGRAM_ID }).instruction();
}

export async function reclaimEscrowIx(P, { owner, envelope, index, destination }) {
  const e = await P.envelope.account.envelope.fetch(envelope);
  return P.envelope.methods.reclaimEscrow(index).accountsPartial({ owner, envelope, escrow: escrowPda(envelope, index), destination,
    envelopeAuthority: authorityPda(e.line), tokenProgram: TOKEN_PROGRAM_ID }).instruction();
}

export const POOL_DEFAULTS = { openWindow: 4, bondBps: 1000, minBond: 1_000_000n, staleSlots: 9000 };

export async function createSealedPoolIx(P, { registrar, base, quote, registrarBase, registrarQuote, baseAmount, quoteAmount, openWindow = 4, bondBps = 1000,
    minBond = 1_000_000n, staleSlots = 9000, opener, label = "", orderedOpen = false }) {
  const pool = poolPda(IDS.sealedPool, base, quote);
  const line = linePda(pool);
  const lab = Buffer.alloc(32); Buffer.from(label).copy(lab);
  const ix = await P.sealedPool.methods.createPool(new anchor.BN(openWindow), bondBps, new anchor.BN(minBond.toString()), new anchor.BN(staleSlots),
      new anchor.BN(baseAmount.toString()), new anchor.BN(quoteAmount.toString()), opener ?? registrar, [...lab], orderedOpen)
    .accountsPartial({ registrar, config: configPda(IDS.sealedPool), baseMint: base, quoteMint: quote, pool,
      baseVault: vaultPda(IDS.sealedPool, pool, base), quoteVault: vaultPda(IDS.sealedPool, pool, quote), lpMint: lpMintPda(IDS.sealedPool, pool),
      registrarBase, registrarQuote, line, bondVault: bondVaultPda(line), envelopeAuthority: authorityPda(line),
      envelopeEventAuthority: eventAuthority(IDS.envelope), envelopeProgram: IDS.envelope, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
  return { ix, pool, line };
}

export async function createOpenPoolIx(P, { registrar, base, quote, registrarBase, registrarQuote, baseAmount, quoteAmount, opener, label = "" }) {
  const pool = poolPda(IDS.openPool, base, quote);
  const lab = Buffer.alloc(32); Buffer.from(label).copy(lab);
  const ix = await P.openPool.methods.createPool(new anchor.BN(baseAmount.toString()), new anchor.BN(quoteAmount.toString()), opener ?? registrar, [...lab])
    .accountsPartial({ registrar, config: configPda(IDS.openPool), baseMint: base, quoteMint: quote, pool,
      baseVault: vaultPda(IDS.openPool, pool, base), quoteVault: vaultPda(IDS.openPool, pool, quote), lpMint: lpMintPda(IDS.openPool, pool),
      registrarBase, registrarQuote, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
  return { ix, pool };
}

export async function openPoolSwapIx(P, { user, pool, base, quote, userBase, userQuote, side, amountIn, minOut }) {
  return P.openPool.methods.swap(side, new anchor.BN(amountIn.toString()), new anchor.BN(minOut.toString()))
    .accountsPartial({ user, pool, baseVault: vaultPda(IDS.openPool, pool, base), quoteVault: vaultPda(IDS.openPool, pool, quote), userBase, userQuote, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
}
