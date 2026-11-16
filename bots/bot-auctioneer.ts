import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { logger } from "./lib/log.js";
import { stopper, wait, waitForRpc } from "./lib/stop.js";
import { keyFor } from "./lib/keys.js";
import { siteFetch, sendViaRelay } from "./lib/feed.js";
import { slot } from "./lib/rpc.js";
import { record } from "./lib/record.js";
import { paceFactor, PAUSED } from "./lib/pace.js";
import { P, IDS, lineOf, bondVaultOf, authorityOf, envelopeEventAuthority } from "./lib/adapter.js";

const log = logger("bot-auctioneer");
const stop = stopper(log);
let lastListAt = 0;
await waitForRpc(log);
const LOT_ORE = BigInt(process.env.BOTS_LOT_ORE_RAW ?? "1000000000");
const RESERVE_TEST = BigInt(process.env.BOTS_LOT_RESERVE_RAW ?? "500000000");
const LOT_SLOTS = Number(process.env.BOTS_LOT_SLOTS ?? "1500");
const REVEAL_SLOTS = Number(process.env.BOTS_LOT_REVEAL_SLOTS ?? "750");
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const lotPda = (seller: PublicKey, id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("lot"), seller.toBuffer(), u64le(id)], IDS.sealedAuction)[0];

async function auctionsOn(): Promise<boolean> {
  const r = await siteFetch("/api/config/public");
  const j: any = await r.json();
  const f = j?.data?.features;
  return Array.isArray(f) ? f.includes("auctions") : !!f?.auctions;
}

async function tick() {
  const kp = await keyFor("bot-auctioneer");
  const lots: any[] = await (P.sealedAuction.account as any).lot.all([{ memcmp: { offset: 8, bytes: kp.publicKey.toBase58() } }]);
  const now = await slot();
  for (const { publicKey, account } of lots) {
    if (account.state !== 0) continue;
    const line: any = await (P.envelope.account as any).line.fetch(account.line);
    if (Number(line.nextExecute) !== Number(line.nextPlace) || now <= Number(account.closeSlot) + Number(account.revealWindow)) continue;
    const ata = (o: PublicKey, m: PublicKey) => getAssociatedTokenAddressSync(m, o, true);
    const ix = await P.sealedAuction.methods.settle().accountsPartial({
      payer: kp.publicKey, lot: publicKey, line: account.line, lotVault: account.lotVault, bidVault: account.bidVault,
      lotMint: account.lotMint, quoteMint: account.quoteMint, seller: account.seller,
      sellerQuote: ata(account.seller, account.quoteMint), sellerLot: ata(account.seller, account.lotMint),
      winner: account.bestBidder, winnerReceive: ata(account.bestBidder, account.lotMint), tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();
    const r = await sendViaRelay([ix], kp);
    await record(log, { kind: "auction", sigs: [r.sig ?? ""], result: r.err ? "failed" : "ok", reason: r.err ? JSON.stringify(r.err) : "settle " + publicKey.toBase58() });
  }
  if (!(await auctionsOn())) return;
  const pf = await paceFactor(log, kp.publicKey.toBase58()).catch(() => 1);
  if (pf === PAUSED) return;
  if (pf > 1 && Date.now() - lastListAt < 120_000 * pf) return;
  lastListAt = Date.now();
  if (lots.some((l) => l.account.state === 0)) return;
  const id = BigInt(Date.now());
  const lot = lotPda(kp.publicKey, id);
  const ix = await P.sealedAuction.methods.listLot(new BN(id.toString()), new BN(LOT_ORE.toString()), new BN(RESERVE_TEST.toString()),
    new BN(now + LOT_SLOTS), new BN(REVEAL_SLOTS), 1000, new BN(1_000_000), new BN(9000)).accountsPartial({
      seller: kp.publicKey, lot, lotMint: IDS.ore, quoteMint: IDS.test, sellerLot: getAssociatedTokenAddressSync(IDS.ore, kp.publicKey),
      line: lineOf(lot), bondVault: bondVaultOf(lineOf(lot)), envelopeAuthority: authorityOf(lineOf(lot)), envelopeEventAuthority, envelopeProgram: IDS.envelope, tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();
  const r = await sendViaRelay([ix], kp);
  await record(log, { kind: "auction", sigs: [r.sig ?? ""], result: r.err ? "failed" : "ok", reason: r.err ? JSON.stringify(r.err) : "list " + lot.toBase58() });
}

log.info("boot", { tickSec: 60, oneOpenLotAtATime: true });
for (;;) {
  if (stop.stopping) break;
  await stop.step(async () => { try { await tick(); } catch (e) { log.error("tick", { e: String(e) }); } });
  await wait(60_000);
}
