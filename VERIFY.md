# Verification

## Public source checks (November 27, 2026)

The four programs built with Anchor 0.31.1, Solana CLI 3.0.0, Rust 1.95.0 and SBF platform tools v1.52. All four generated program interfaces matched the checked-in IDLs after canonicalization. The checked-in client and all 13 protocol-flow tests ran on Node 22.23.4 against a fresh local validator. All 13 passed. The TypeScript worker package passed its type check, the Rust workspace passed its formatting check, and all four README diagrams rendered.

Run the public checks from a clean checkout with the commands in CONTRIBUTING.md. These checks cover the local validator and the public source snapshot.

## Source snapshot checks (November 25, 2026)

The following record describes the original project workspace. The public test suite includes its 13 protocol-flow tests.

### Procedure

1. The project's own program workspace was copied without build output and built with `anchor build --no-idl -- --tools-version v1.52` and `anchor idl build` for each program, then tested with `node --test tests/` against a local validator with the four programs loaded at their fixed ids, upgrade authority none.
2. This folder was copied to an empty temporary folder and built there from its own files only, with the pinned toolchain: `npm ci`, `bash scripts/build.sh`, then `npm test` against the same local validator, and `npm ci` plus `npm run typecheck` in `bots/`.
3. Each IDL in `idl/` was compared with the IDL built from the project's workspace and with the IDL built from this folder, by the sha256 of the JSON with every `docs` key removed, keys sorted and no whitespace. Program bytes are not compared, because removing comments moves line numbers inside panic messages.
4. `cargo fmt --all -- --check` was run on this folder.
5. Every Mermaid block in README.md was rendered with mermaid-cli.

Limits: the tests show the behaviour they exercise on a local validator. They are not an audit, and they do not test the network's validators.

```text
date: 2026-11-25T12:25:07Z
toolchain: rustc 1.95.0; solana-cli 3.0.0; anchor-cli 0.31.1; node 26.13.1; platform-tools v1.52
build: bash scripts/build.sh -> exit=0
build: npm --prefix bots run typecheck -> exit=0
test: npm test -> passed=14 failed=0
total: passed=14 failed=0
idl: idl/envelope.json original_sha256=5bc2ad138aeabddbad5ddc1936986cea7b6729055ce05f69831caab679f88465 github_sha256=5bc2ad138aeabddbad5ddc1936986cea7b6729055ce05f69831caab679f88465 match=yes
idl: idl/sealed_pool.json original_sha256=463e78e192e323995fba716534605042fe8005425cca4423c45d6a961f497952 github_sha256=463e78e192e323995fba716534605042fe8005425cca4423c45d6a961f497952 match=yes
idl: idl/open_pool.json original_sha256=66d73f594d0153b3ed5bdcf81f45dfdcc5fcd3f041526b8ad51ea2634e18897a github_sha256=66d73f594d0153b3ed5bdcf81f45dfdcc5fcd3f041526b8ad51ea2634e18897a match=yes
idl: idl/sealed_auction.json original_sha256=185e5706460bfc3a07235b8e35bfb2a42ab7662a2aaf0fa705d8d157f5ea31e0 github_sha256=185e5706460bfc3a07235b8e35bfb2a42ab7662a2aaf0fa705d8d157f5ea31e0 match=yes
parity: original_passed=14 github_passed=14
mermaid: rendered=4/4
```
