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
