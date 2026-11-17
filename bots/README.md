# Bots

The project's own accounts on the Tell chain. Their public keys are in `bots.json` and `keys.public.json`. Every figure counts them apart from people, and every screen labels them as the project's.

## Processes

| process | what it does | sends through |
|---|---|---|
| executor | calls `execute` for each due place as soon as its open window has ended | RPC (execute is permissionless and not an order) |
| bot-lp | keeps the sealed and the open pool at the same depth | relay (pending feed) |
| bot-target | one large order per period into both pools, same size and side | relay (pending feed) |
| bot-auctioneer | lists one lot at a time while auctions are on; settles due lots | relay |

Chain wiring: `lib/adapter.ts` builds instructions with Anchor's `.instruction()` from the IDLs in `../idl`. Confirmation is by HTTP polling only.

Records: each attempt is appended to `records/<kind>.jsonl`, and also posted to `BOTS_INGEST_URL` when it is set.

Measurements: `measure/seal-to-execute.ts` and `measure/tally.ts sandwich-open-pool|sandwich-sealed-pool|unopened-attack [--since ISO]`; each ends with `value=<number>`. `ops/balances.ts` (`npm run balances`) prints both pools' reserves and each bot's first key's balances.

Workers run at half speed when the disk file's `freePct` is below `BOTS_DISK_HALF_PCT` (20); bot-target, bot-lp and bot-auctioneer stop below `BOTS_DISK_STOP_PCT` (10). The executor never pauses. They also slow by `BOTS_SLOW_FACTOR` when the faucet reserve is below `BOTS_FAUCET_RESERVE_MIN`.

## Environment

Read by all processes:

| variable | default | use |
|---|---|---|
| `BOTS_KEY_DIR` | required | folder with the key files `tell-chain-<role>.json`; a key must be listed in `bots.json` |
| `TELL_RPC_URL` | `http://127.0.0.1:8899` | the chain's RPC |
| `BOTS_RPS_CAP` | 8 | requests per second per process |
| `TELL_IDL_DIR` | `../idl` | the programs' IDLs |
| `TELL_TEST_MINT`, `TELL_ORE_MINT` | the chain's fixed mints | override only for a local rehearsal on throwaway mints |
| `TELL_CHAIN_ADAPTER` | `./adapter.js` | chain adapter module |

Read by bot-lp, bot-target, bot-auctioneer and the measurements:

| variable | default | use |
|---|---|---|
| `BOTS_SITE_URL` | `http://127.0.0.1:3000` | the site with the pending feed, the relay and the faucet |
| `BOTS_SITE_TOKEN` | none | bearer token sent to the site |
| `BOTS_RELAY` | none | `direct` sends straight to the RPC (local rehearsal without a site) |
| `BOTS_RECORD_DIR` | `records` | local attempt records |
| `BOTS_INGEST_URL`, `BOTS_INGEST_TOKEN` | none | where attempts are also posted, and its bearer token |
| `BOTS_DISK_FILE` | none | JSON file `{"freePct": n}` for the disk bound |
| `BOTS_DISK_HALF_PCT`, `BOTS_DISK_STOP_PCT` | 20, 10 | disk bounds |
| `BOTS_FAUCET_RESERVE_MIN`, `BOTS_SLOW_FACTOR` | 1000000, 4 | faucet reserve bound and the slow-down factor |

Per process:

| process | variable | default |
|---|---|---|
| executor | `BOTS_EXECUTOR_TICK_MS` | 400 |
| bot-lp | `BOTS_LP_PERIOD_SEC`, `BOTS_LP_GAP_BPS` | 300, 100 |
| bot-target | `BOTS_TARGET_PERIOD_SEC`, `BOTS_TARGET_SIZE_PCT`, `BOTS_TARGET_SLIPPAGE_BPS` | 60, 2, 300 |
| bot-auctioneer | `BOTS_AUCTIONEER_PERIOD_SEC`, `BOTS_LOT_ORE_RAW`, `BOTS_LOT_RESERVE_RAW`, `BOTS_LOT_SLOTS` | 1800, 1000000000, 500000000, 1500 |
| seal-to-execute | `MEASURE_VIA` | `relay` |

## Run

```
npm ci
npm run typecheck
TELL_RPC_URL=http://127.0.0.1:8899 BOTS_KEY_DIR=<folder with the key files> npm run executor
```

The other processes start the same way: `npm run bot-lp`, `npm run bot-target`, `npm run bot-auctioneer`, `npm run tally -- sandwich-open-pool`, `npm run seal-to-execute`.
