#!/usr/bin/env bash
# Build Lambda handler zips.
# Each zip contains only handler.py — all shared code lives in Lambda layers.
#
# Usage:
#   bash scripts/build_handlers.sh
#   LAMBDA_ZIPS_BUCKET=my-bucket bash scripts/build_handlers.sh   # also uploads to S3
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${REPO_ROOT}/dist/handlers"
HANDLERS_DIR="${REPO_ROOT}/handlers"

mkdir -p "${DIST}"

echo "Building handlers..."

for handler_file in "${HANDLERS_DIR}"/*.py; do
  name="$(basename "${handler_file}" .py)"
  tmp="$(mktemp -d)"

  # Each handler is packaged as handler.py — matches Terraform handler = "handler.handler"
  cp "${handler_file}" "${tmp}/handler.py"

  zip -j "${DIST}/${name}.zip" "${tmp}/handler.py"
  rm -rf "${tmp}"

  echo "  built dist/handlers/${name}.zip"
done

echo "Done. ${DIST}/"

# ── Optional S3 upload ───────────────────────────────────────────────────────
if [[ -n "${LAMBDA_ZIPS_BUCKET:-}" ]]; then
  echo "Uploading handlers to s3://${LAMBDA_ZIPS_BUCKET}/handlers/ ..."
  aws s3 sync "${DIST}/" "s3://${LAMBDA_ZIPS_BUCKET}/handlers/"
  echo "Upload complete."
fi
