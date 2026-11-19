# Security

## Supported versions

| Component | Version | Supported |
| --- | --- | --- |
| envelope, sealed_pool, open_pool, sealed_auction | the builds installed in the Tell chain's genesis | yes |
| client/ | the version in this repository | yes |
| engine patches in patches/ | Agave v3.0.9 | yes |

The four programs are installed in genesis with no upgrade authority. A fix to one of them cannot replace the installed program; it ships as a new program beside it, and the change is announced on the website and on X.

## Reporting a vulnerability

Report it privately through GitHub Security Advisories on this repository ("Report a vulnerability" under the Security tab). Please include the instruction, the accounts involved, the slot or transaction if you saw it on the chain, and the smallest steps that reproduce it.

Please do not open a public issue for a vulnerability and do not test against other people's envelopes on the live network. The chain runs on faucet test money, so a local validator started with `scripts/local-validator.sh` reproduces everything the network does.

## Scope

In scope:

- The four programs in `programs/`: account validation, the consumer rule, the fingerprint check, bond handling, escrow refunds, the execute cursor, pool and auction arithmetic.
- `client/index.js`: the fingerprint preimage, PDA derivation and instruction building.
- The three patches in `patches/` and the genesis configuration in `docs/GENESIS.md`.
- `scripts/line-order.mjs`: a count that reports fewer out-of-line executions than the blocks hold.

Out of scope:

- The ordering of transactions by the validators themselves. All four validators are run by the project; the rule is a rule of the programs, not of the engine.
- The project's own pending feed and relay, which are part of the website and not of this repository.
- An envelope that its sender does not open, or an opened order that is not filled. That is a known property of the method: its bond is burned. The bond returns only on a fill, and for an auction bid also when it is outbid.
- Denial of service against the public RPC, and anything that needs the project's keys.
