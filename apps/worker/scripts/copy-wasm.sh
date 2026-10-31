#!/usr/bin/env bash
# The bundle has no node_modules, so the runtime and grammars go in one folder (TREE_SITTER_GRAMMARS).
set -euo pipefail
root=../../node_modules
mkdir -p dist/wasm
cp "$root/web-tree-sitter/tree-sitter.wasm" dist/wasm/
for language in typescript tsx javascript python go rust java; do
  cp "$root/tree-sitter-wasms/out/tree-sitter-$language.wasm" dist/wasm/
done
