import anchor from "@coral-xyz/anchor";
const { BN } = anchor;
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { randomBytes } from "node:crypto";
import { keyFor } from "../lib/keys.js";
import { send, slot } from "../lib/rpc.js";
import { wait } from "../lib/stop.js";
import { P, IDS, lineOf, envelopeOf, bondVaultOf, authorityOf, envelopeEventAuthority, encodeContent, fingerprintOf, openIxs, envelopeRaw } from "../lib/adapter.js";
import { waitDone } from "../lib/order.js";

const ata = (o: PublicKey, m: PublicKey) => getAssociatedTokenAddressSync(m, o, true);
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const T = (n: number) => BigInt(n) * 1_000_000n;
const LOT = T(1000), RESERVE = T(500), CLOSE_IN = 120, REVEAL = 150;

const seller = await keyFor("bot-auctioneer");
const bidders = [
  { name: "bot-lp", kp: await keyFor("bot-lp"), amount: T(450) },
  { name: "bot-sandwich", kp: await keyFor("bot-sandwich"), amount: T(1050) },
  { name: "bot-lp", kp: await keyFor("bot-lp"), amount: T(1200) },
];
const id = BigInt(Date.now());
const lot = PublicKey.findProgramAddressSync([Buffer.from("lot"), seller.publicKey.toBuffer(), u64le(id)], IDS.sealedAuction)[0];
const line = lineOf(lot);
const now = await slot();
const closeSlot = now + CLOSE_IN;
const listIx = await P.sealedAuction.methods.listLot(new BN(id.toString()), new BN(LOT.toString()), new BN(RESERVE.toString()), new BN(closeSlot), new BN(REVEAL), 1000, new BN(1_000_000), new BN(9000))
  .accountsPartial({ seller: seller.publicKey, lot, lotMint: IDS.ore, quoteMint: IDS.test, sellerLot: ata(seller.publicKey, IDS.ore), line,
    bondVault: bondVaultOf(line), envelopeAuthority: authorityOf(line), envelopeEventAuthority, envelopeProgram: IDS.envelope, tokenProgram: TOKEN_PROGRAM_ID })
  .instruction();
const listed = await send([listIx], seller);
if (listed.err) { console.log(JSON.stringify({ step: "list", err: listed.err })); process.exit(1); }

const bids: any[] = [];
for (const b of bidders) {
  const l: any = await (P.envelope.account as any).line.fetch(line);
  const place = Number(l.nextPlace);
  const content = encodeContent({ program: IDS.sealedAuction, payload: Buffer.concat([Buffer.from([0]), u64le(b.amount)]), escrows: [{ mint: IDS.test, amount: b.amount }] });
  const secret = randomBytes(32);
  const fp = fingerprintOf(line, b.kp.publicKey, content, secret);
  const envelope = envelopeOf(line, place);
  const ix = await P.envelope.methods.seal([...fp], new BN(b.amount.toString())).accountsPartial({
    owner: b.kp.publicKey, line, envelope, bondSource: ata(b.kp.publicKey, IDS.test), bondVault: bondVaultOf(line), bondMint: IDS.test,
    tokenProgram: TOKEN_PROGRAM_ID, eventAuthority: envelopeEventAuthority, program: IDS.envelope }).instruction();
  const r = await send([createAssociatedTokenAccountIdempotentInstruction(b.kp.publicKey, ata(b.kp.publicKey, IDS.ore), b.kp.publicKey, IDS.ore), ix], b.kp);
  bids.push({ ...b, place, envelope, content, secret, fingerprint: Buffer.from(fp).toString("hex"), sealSig: r.sig, sealSlot: r.slot, err: r.err });
  if (r.err) { console.log(JSON.stringify({ step: "seal", bidder: b.name, err: r.err })); process.exit(1); }
}
while ((await slot()) <= closeSlot) await wait(400);
for (const b of bids) {
  const e: any = await envelopeRaw(b.envelope);
  const ixs = await openIxs(b.kp, { line, place: b.place, envelope: b.envelope, content: b.content, secret: b.secret, fingerprint: Buffer.from(b.fingerprint, "hex"), cap: b.amount });
  const r = await send(ixs, b.kp);
  b.openSig = r.sig; b.openSlot = r.slot; b.openErr = r.err; b.openDeadline = Number(e.openDeadline);
}
for (const b of bids) { const d = await waitDone(b.envelope, 240_000); b.end = d.state; b.won = null; b.executedSlot = d.executedSlot; b.filled = d.consumerOk; }
const lotAcc: any = await (P.sealedAuction.account as any).lot.fetch(lot);
const settleIx = await P.sealedAuction.methods.settle().accountsPartial({
  payer: seller.publicKey, lot, line, lotVault: lotAcc.lotVault, bidVault: lotAcc.bidVault, lotMint: lotAcc.lotMint, quoteMint: lotAcc.quoteMint, seller: lotAcc.seller,
  sellerQuote: ata(lotAcc.seller, lotAcc.quoteMint), sellerLot: ata(lotAcc.seller, lotAcc.lotMint), winner: lotAcc.bestBidder,
  winnerReceive: ata(lotAcc.bestBidder, lotAcc.lotMint), tokenProgram: TOKEN_PROGRAM_ID }).instruction();
let settled: any = null;
for (let i = 0; i < 10 && !settled; i++) { const r = await send([settleIx], seller); if (!r.err) settled = r; else { await wait(3000); if (i === 9) settled = r; } }
const after: any = await (P.sealedAuction.account as any).lot.fetch(lot);
console.log(JSON.stringify({
  lot: lot.toBase58(), lotId: id.toString(), line: line.toBase58(), seller: seller.publicKey.toBase58() + " (bot-auctioneer)", lotAmount: "1000 ORE", reserve: "500 TEST",
  listSig: listed.sig, listSlot: listed.slot, closeSlot, revealWindowSlots: REVEAL,
  bids: bids.map((b) => ({ bidder: b.name + " " + b.kp.publicKey.toBase58(), place: b.place, amount: String(Number(b.amount) / 1e6) + " TEST", fingerprint: b.fingerprint,
    sealSig: b.sealSig, sealSlot: b.sealSlot, openSig: b.openSig, openSlot: b.openSlot, openErr: b.openErr ?? undefined, end: b.end, executedSlot: b.executedSlot, filled: b.filled })),
  winner: after.bestBidder.toBase58(), price: String(Number(after.bestBid) / 1e6) + " TEST", bestPlace: Number(after.bestPlace),
  settleSig: settled?.sig, settleSlot: settled?.slot, settleErr: settled?.err ?? undefined, state: after.state,
}, null, 1));
process.exit(0);
