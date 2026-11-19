# Contributing

Thank you for looking at Tell. Issues and pull requests are welcome.

## Toolchain

| Tool | Version |
| --- | --- |
| Rust (host, IDL build) | 1.95.0 (`rust-toolchain.toml`) |
| Solana CLI (Agave) | 3.0.0 |
| SBF platform tools | v1.52 |
| Anchor CLI | 0.31.1 |
| Node.js | 22 or newer |

Platform tools v1.52 are needed because some crates in the dependency tree use edition 2024 manifests.

## Build

```bash
npm ci
bash scripts/build.sh
```

`scripts/build.sh` builds the four programs with `anchor build --no-idl -- --tools-version v1.52`, then each IDL with `anchor idl build -p <name>`, and prints the sha256 of each program.

## Test

The tests run against a local validator with the four programs loaded at their fixed ids, upgrade authority none:

```bash
bash scripts/local-validator.sh &
npm test
```

`npm test` runs `node --test tests/*.test.mjs`. Set `TELL_RPC` to point the tests at another validator.

`TELL_REGISTRAR` may name a keypair file to use as the pools' registrar; without it each run makes a fresh one, which needs a freshly reset validator.
## Bots

```bash
cd bots
npm ci
npm run typecheck
```

## Lint

```bash
cargo fmt --all -- --check
```

## Pull requests

- One change per pull request, with a test that fails before it and passes after.
- A change to an account layout, an instruction or an event changes the IDL: say so in the description and update `idl/`.
- The installed programs cannot be upgraded. A change to program logic is a proposal for a new program, not a fix to the running one.
- No comments in code; names carry the meaning.
