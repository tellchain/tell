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
