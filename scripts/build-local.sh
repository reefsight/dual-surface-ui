#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: $0 (build and create an npm tarball; no registry publication)"
  exit 0
fi
[[ $# -eq 0 ]] || { echo "Unexpected argument." >&2; exit 2; }
artifact_dir="${ARTIFACT_DIR:-/tmp/dual-surface-ui-package}"
mkdir -p "$artifact_dir"
artifact_dir="$(cd "$artifact_dir" && pwd)"
npm ci
npm run build
npm pack --pack-destination "$artifact_dir"
