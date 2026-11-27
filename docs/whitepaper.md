# Tell: sealed orders that take their place in line before anyone can read them

Tell is a network the project runs itself, built from Solana's validator software (Agave). An order is sent first as a fingerprint only; the chain gives that fingerprint a place in line; after the place is final the sender opens the order; execution follows the line. Every coin on this network is test money from its faucet. This paper states only what runs and what has been measured, and how anyone can check both with the tools they already have.

## What runs today

The network is four validators, all run by the project, built from Agave v3.0.9 (upstream commit 3454667767e36a915e174124c04f7e320bf37c1a) with three patch files and nothing else. The validator carries two storage changes and no change to consensus or execution: the lowest allowed ledger size is lowered (one constant, `DEFAULT_MIN_MAX_LEDGER_SHREDS`, from 50,000,000 to 100,000), and the ledger database's write-ahead log is capped at 1 GiB instead of 4 GiB, so a small network can bound its own disk. The genesis tool carries one fix: a program installed with no upgrade authority is written with no authority at all, instead of the all-zero key. The build is recorded with the hash of every patch and binary, and the stock Solana CLI 3.0 and web3.js work against the network with only the RPC address changed.

The network's final genesis has the hash Bvfk4a7a77yM1p6p9ZqosvqCiddsQh5GaPi5CXQY2ybY and its slot 0 is dated 2026-11-25T01:07:37Z (UTC, the block time); it is never reset, so every order since then stays countable.

Four programs are part of the network's genesis, installed under the upgradeable loader with no upgrade authority, so nobody, the project included, can change them:

- the envelope program: `seal` takes a fingerprint, a public cap ("this order is not larger than X") and a bond, and gives the next place in that market's line; `open` takes the order and its secret within the open window and checks them against the fingerprint; `execute`, which anyone may call, runs opened orders strictly in place order, returns their bonds, and burns the bond of every envelope that was not opened;
- the sealed pool: a constant-product pool with a 0.25 % fee whose swap, add and remove entries accept only the envelope program's signer, so an order that wants to step in front must itself be sealed, blind and with a bond: sealed after the order it targets, it gets a later place; sealed ahead of it, it must guess, and every side it does not open loses its bond;
- the open pool: the same pool with public entries, kept beside it for comparison;
- the sealed auction: lots whose bids are envelopes, opened only after the lot closes (behind a switch, not open yet).

The fingerprint is `sha256("blindfold:v1" || line || owner || length || order || secret)`, where the secret is 32 random bytes made in the sender's browser. Until the sender opens it, the content of an order is known only to the sender: not to the validators and not to the project. The test assets are TEST (the faucet's money) and ORE (the traded asset); amounts are always shown with their unit.

## Measurements

On November 25, 2026, the project measured the SLAB/TEST market using project-operated accounts and faucet tokens. The figures cover one market configuration and observation period.

| Observation | Result |
| --- | --- |
| Executions out of line order | 0 in each of five runs |
| Seal to execution | 7,042.5 ms median and 8,627 ms p99 over ten runs |
| Comparison participant, open pool | +29,515.08 TEST |
| Comparison participant, sealed pool | −48,668.07 TEST |
| Separate selective-opening sample | −36,357.47 TEST after bonds |
| Ledger size change, extrapolated from three ten-minute windows | −10.52 GB/day median and +53.44 GB/day p99 |

The database was compacting at its configured size cap. The short windows do not establish a long-term growth rate. The economic results depend on bond size, liquidity and transaction ordering.

## How to check ordering

Run the block counter from the repository root. It reads execution, skip and void events in block order and checks each sealed-pool line against its cursor.

```sh
node scripts/line-order.mjs --rpc <rpc-url> --from 0
```

With the stock Solana CLI and the public RPC address shown on the site's Verify page:

1. `solana -u <the public RPC address> program show <program id>` prints `Authority: none` for each of the four programs.
2. `solana -u <the public RPC address> block <slot>` and `solana -u <the public RPC address> confirm -v <signature>` show an execute transaction and its program log.
3. `node scripts/line-order.mjs --rpc <the public RPC address>` recounts "N executed, 0 out of line" from the blocks themselves.

The source of the patches, the programs and these scripts is published with the project's public code.

## Sources

- Upstream engine: Agave v3.0.9 (Anza), https://github.com/anza-xyz/agave, the release this network is built from.
- Token programs in genesis: SPL Token 3.5.0, Token-2022 8.0.0, Associated Token Account 1.1.1 and Memo 1.0.0 / 3.0.0, the program files that ship inside that Agave release.
- A different method, for comparison: Jito's Block Assembly Marketplace orders transactions inside a trusted execution environment (AMD SEV-SNP) on its own nodes, as described at https://www.helius.dev/blog/block-assembly-marketplace-bam . Tell uses no key committee and no secure chip: the sender seals and the sender opens, and in exchange the sender acts twice (the browser wallet does both steps).

## What does not work yet

- Selective opening remains possible. A sender can abandon a commitment and lose the bond. The measured bond cost is specific to the tested pool and observation window.
- The sender must open. An envelope is opened by the browser that sealed it, inside a short window of slots. A closed browser cannot open, and the bond of an unopened envelope is burned; the wallet warns before the page closes.
- What the claim covers. It holds for orders of programs that accept envelopes: the sealed pool, and the sealed auction behind its switch. Other transactions on the network are ordinary transactions.
- Who runs it. All four validators are the project's. Outsiders reach the network only as RPC clients; nobody else validates it yet.
- What it is not. The seal is a fingerprint and an opening, not encryption. Balances are not hidden. It is not Solana mainnet and not a service on it; it is a separate network built from the same software. Every coin on it is faucet test money with no price, so nothing here is a figure in any currency.
- History. A node keeps only hours of history; the project keeps its own index from genesis, and the recount above reads what the node still holds.
- Not measured yet: the slot time as a rig record, and the network under load from many outside users. Their rows are added when their runs finish.
