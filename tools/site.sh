#!/usr/bin/env bash
# tools/site.sh <museum document> <out dir>: assembles a deployable site, the
# page and its scripts and wasm from web/ plus the given document as
# museum.json. Built documents in web/ are never copied, so a private one
# lying around locally cannot ride along.
set -euo pipefail
doc="${1:?usage: site.sh <museum.json> <out dir>}"
out="${2:?usage: site.sh <museum.json> <out dir>}"
here="$(cd "$(dirname "$0")/.." && pwd)"
python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); assert d.get("schema") == "museum/1", "not a museum/1 document"' "$doc"
mkdir -p "$out"
for f in index.html museum-layout.js museum-walk.js museum-scene.js museum-scene.wasm strata-kit.js strata-loader.js; do
  cp "$here/web/$f" "$out/"
done
cp "$doc" "$out/museum.json"
ls -la "$out"
