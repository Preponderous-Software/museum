#!/usr/bin/env bash
# Builds the museum scene (scene/main.cpp) into web/museum-scene.{js,wasm}
# with the vendored Strata web kit and a SHA-pinned Strata release.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
kit="$here/strata-kit"
(cd "$kit" && sha256sum -c --quiet SHA256SUMS)

export KIT_SOURCE="$here/main.cpp"
export KIT_OUT="$here/../web"
export KIT_NAME=museum-scene
export KIT_EXPORT_NAME=createMuseumScene
export KIT_EXPORTS=_mu_set_static,_mu_set_dynamic,_mu_set_lights,_mu_set_cull_distance
export KIT_WORK="${MUSEUM_WORK:-$here/.build}"
export EMSDK_VERSION=6.0.11
export STRATA_VERSION=0.7.0
export STRATA_SHA256=1aab559eb2477f42bfbeae1cd2e3cf70fcb8aa8b28fc8dce16ba1e0ba855049f

"$kit/build-kit.sh"
