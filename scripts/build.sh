#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${SBF_TOOLS_VERSION:-v1.52}"
cd "$HERE"
mkdir -p target/idl target/types
anchor build --no-idl -- --tools-version "$TOOLS"
for n in envelope sealed_pool open_pool sealed_auction; do
  anchor idl build -p "$n" -o "target/idl/$n.json" -t "target/types/$n.ts"
done
(cd target/deploy && sha256sum envelope.so sealed_pool.so open_pool.so sealed_auction.so)
