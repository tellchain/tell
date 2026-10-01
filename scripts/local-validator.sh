#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
D="$HERE/target/deploy"
exec solana-test-validator --reset --quiet --limit-ledger-size 50000 --ledger "$HERE/test-ledger" \
  --upgradeable-program jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF "$D/envelope.so" none \
  --upgradeable-program D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7 "$D/sealed_pool.so" none \
  --upgradeable-program HxzVrsgrfeYXmdjT5cxsZBaj6z4WdQMqQjTp8Z7EN957 "$D/open_pool.so" none \
  --upgradeable-program CWvRXgP4d9QGZFEt1DBEBnpECtUEW5F1hRD1QKbZ5YMH "$D/sealed_auction.so" none
