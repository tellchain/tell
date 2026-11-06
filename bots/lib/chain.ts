import type { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

export type Side = "buy" | "sell";
export type EnvState = "sealed" | "opened" | "executed" | "skipped" | "voided";
export type EnvelopeView = {
  place: number; owner: string; state: EnvState; sealedSlot: number;
  fingerprint: string; cap: bigint; bond: bigint;
};
export type SwapContent = { pool: PublicKey; side: Side; amountIn: bigint; minOut: bigint };
export type Reserves = { base: bigint; quote: bigint; feeBps: number };

export interface Chain {
  pools(): Promise<{ sealed: PublicKey[]; open: PublicKey[]; pairOf(p: PublicKey): PublicKey | null }>;
  openWindowSlots(): Promise<number>;
  bondFor(cap: bigint): Promise<bigint>;
  dueBatches(currentSlot: number): Promise<{ line: PublicKey; places: number[] }[]>;
  buildExecute(payer: PublicKey, line: PublicKey, places: number[]): Promise<TransactionInstruction[][]>;
  envelope(line: PublicKey, place: number): Promise<EnvelopeView | null>;
  staleLines(currentSlot: number): Promise<PublicKey[]>;
  buildVoidStale(payer: PublicKey, line: PublicKey): Promise<TransactionInstruction[]>;
  newSecret(): Uint8Array;
  fingerprint(content: SwapContent, secret: Uint8Array): Uint8Array;
  buildSeal(owner: Keypair, pool: PublicKey, fingerprint: Uint8Array, cap: bigint, bond: bigint): Promise<{ ixs: TransactionInstruction[]; expectedPlace: number }>;
  placeOfSeal(sig: string): Promise<number>;
  buildOpen(owner: Keypair, pool: PublicKey, place: number, content: SwapContent, secret: Uint8Array): Promise<TransactionInstruction[]>;
  reserves(pool: PublicKey): Promise<Reserves>;
  buildOpenSwap(owner: Keypair, content: SwapContent): Promise<TransactionInstruction[]>;
  buildOpenLiquidity(owner: Keypair, pool: PublicKey, action: "add" | "remove", base: bigint, quote: bigint): Promise<TransactionInstruction[]>;
  sealedLiquidityContent?(pool: PublicKey, action: "add" | "remove", base: bigint, quote: bigint): unknown;
  balances(owner: PublicKey): Promise<{ test: bigint; ore: bigint; native: bigint }>;
  received(sig: string, owner: PublicKey, side: Side): Promise<bigint | null>;
  listLot?(seller: Keypair, asset: bigint, reserve: bigint, closeSlot: number): Promise<{ ixs: TransactionInstruction[] }>;
}

export function cpOut(r: Reserves, side: Side, amountIn: bigint): bigint {
  const [rin, rout] = side === "buy" ? [r.quote, r.base] : [r.base, r.quote];
  const inAfterFee = (amountIn * BigInt(10_000 - r.feeBps)) / 10_000n;
  if (inAfterFee <= 0n) return 0n;
  return (rout * inAfterFee) / (rin + inAfterFee);
}
export function applySwap(r: Reserves, side: Side, amountIn: bigint): Reserves {
  const out = cpOut(r, side, amountIn);
  return side === "buy"
    ? { ...r, quote: r.quote + amountIn, base: r.base - out }
    : { ...r, base: r.base + amountIn, quote: r.quote - out };
}
