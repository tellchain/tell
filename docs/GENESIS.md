# Engine and genesis

Tell runs Agave v3.0.9 with two engine changes, both disk settings (the ledger floor and a cap on the ledger database's write-ahead log; nothing in consensus or execution), plus one genesis-tool fix so that the programs carry no upgrade authority. All three are in `patches/`.

## Source

| Item | Value |
| --- | --- |
| Repository | https://github.com/anza-xyz/agave |
| Tag | v3.0.9 |
| Commit | 3454667767e36a915e174124c04f7e320bf37c1a |
| Binaries built | agave-validator, solana-genesis, solana-faucet, solana-keygen, solana |

## The three patches

| File | Touches | What it does |
| --- | --- | --- |
| `patches/ledger-floor.patch` | `ledger/src/blockstore_cleanup_service.rs` | Lowers `DEFAULT_MIN_MAX_LEDGER_SHREDS` from 50,000,000 to 100,000, so a validator may keep a small ledger. A disk setting. |
| `patches/ledger-wal.patch` | `ledger/src/blockstore_db.rs` | Lowers the ledger database's total write-ahead log size from 4 GiB to 1 GiB (`set_max_total_wal_size`), for a small network's disk budget. A disk setting. The patch is kept byte for byte as the running network was built from it, so its comment still uses the project's working name. |
| `patches/genesis-no-authority.patch` | `genesis/src/main.rs` | With `--upgradeable-program <id> <loader> <elf> none`, stock `solana-genesis` writes the zero key as the upgrade authority. The patch writes no authority at all (`ProgramData` holds `None`) and keeps the ELF at the fixed metadata offset. It changes `solana-genesis` only; the validator does not run this code. |

## Build the engine

```bash
git clone https://github.com/anza-xyz/agave
cd agave
git checkout v3.0.9
git apply ../patches/ledger-floor.patch
git apply ../patches/ledger-wal.patch
git apply ../patches/genesis-no-authority.patch
cargo build --release --bin agave-validator --bin solana-genesis --bin solana-faucet --bin solana-keygen --bin solana
```

## Programs in genesis

The SPL programs are the ELF files that ship inside Agave v3.0.9 under `program-test/src/programs`, installed with loader v2, which has no upgrade authority by construction:

| Program | Address | ELF |
| --- | --- | --- |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | spl_token-3.5.0.so |
| SPL Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | spl_token_2022-8.0.0.so |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | spl_associated_token_account-1.1.1.so |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | spl_memo-3.0.0.so |
| Memo (v1) | `Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo` | spl_memo-1.0.0.so |

The four Tell programs are built by `scripts/build.sh` and installed with loader v3 (`BPFLoaderUpgradeab1e11111111111111111111111`) and upgrade authority `none`:

| Program | Address |
| --- | --- |
| envelope | `jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF` |
| sealed_pool | `D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7` |
| open_pool | `HxzVrsgrfeYXmdjT5cxsZBaj6z4WdQMqQjTp8Z7EN957` |
| sealed_auction | `CWvRXgP4d9QGZFEt1DBEBnpECtUEW5F1hRD1QKbZ5YMH` |

With the patched `solana-genesis`, each is one argument:

```bash
solana-genesis \
  --upgradeable-program jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF BPFLoaderUpgradeab1e11111111111111111111111 target/deploy/envelope.so none \
  --upgradeable-program D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7 BPFLoaderUpgradeab1e11111111111111111111111 target/deploy/sealed_pool.so none \
  --upgradeable-program HxzVrsgrfeYXmdjT5cxsZBaj6z4WdQMqQjTp8Z7EN957 BPFLoaderUpgradeab1e11111111111111111111111 target/deploy/open_pool.so none \
  --upgradeable-program CWvRXgP4d9QGZFEt1DBEBnpECtUEW5F1hRD1QKbZ5YMH BPFLoaderUpgradeab1e11111111111111111111111 target/deploy/sealed_auction.so none \
  ...
```

The remaining arguments (bootstrap validator identity, vote and stake accounts, faucet, ledger path) are the stock ones and are made per network; no key is part of this repository.

## Validators

Four validators, all run by the project. Genesis holds one bootstrap validator; three more join with stake, which is then spread to equal shares (25% each once warm), so any three of the four hold more than two thirds of the stake.

## Check it on the network

```bash
solana -u <rpc> program show jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF
```

The stock CLI prints `Authority: none` for each of the four programs. The public RPC is listed on the website's verify page.
