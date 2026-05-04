#!/usr/bin/env bash
# Build Lambda layer zips.
# Lambda layers must follow the layout:  python/<packages>/
#
# The python_deps layer is built for manylinux (Amazon Linux / Lambda) using
# pip's --platform flag — no Docker required.
#
# Usage:
#   bash scripts/build_layers.sh
#   LAMBDA_ZIPS_BUCKET=my-bucket bash scripts/build_layers.sh   # also uploads to S3
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${REPO_ROOT}/dist/layers"
mkdir -p "${DIST}"

# ── Layer 1: superdoc_utils ──────────────────────────────────────────────────
echo "Building superdoc_utils layer..."
UTILS_TMP="$(mktemp -d)"
mkdir -p "${UTILS_TMP}/python"
cp -R "${REPO_ROOT}/layers/superdoc_utils/." "${UTILS_TMP}/python/"
rm -f "${DIST}/superdoc_utils.zip"
(cd "${UTILS_TMP}" && zip -r "${DIST}/superdoc_utils.zip" python/ -x "*.pyc" -x "*/__pycache__/*" -x "*.bak*")
rm -rf "${UTILS_TMP}"
echo "  built dist/layers/superdoc_utils.zip ($(du -sh "${DIST}/superdoc_utils.zip" | cut -f1))"

# ── Layer 2: python_deps ─────────────────────────────────────────────────────
# Uses --platform manylinux2014_x86_64 + --python-version 3.12 to download
# Lambda-compatible wheels from macOS/Linux without Docker.
echo "Building python_deps layer (manylinux wheels for python3.12)..."
DEPS_TMP="$(mktemp -d)"
mkdir -p "${DEPS_TMP}/python"
pip3 install \
  --requirement "${REPO_ROOT}/layers/python_deps/requirements.txt" \
  --target "${DEPS_TMP}/python" \
  --platform manylinux2014_x86_64 \
  --python-version 3.12 \
  --only-binary=:all: \
  --upgrade \
  --quiet
rm -f "${DIST}/python_deps.zip"
(cd "${DEPS_TMP}" && zip -r "${DIST}/python_deps.zip" python/ -x "*.pyc" -x "*/__pycache__/*" -x "*.dist-info/*" -x "*.egg-info/*")
rm -rf "${DEPS_TMP}"
echo "  built dist/layers/python_deps.zip ($(du -sh "${DIST}/python_deps.zip" | cut -f1))"

echo "Done. ${DIST}/"

# ── Optional S3 upload ───────────────────────────────────────────────────────
if [[ -n "${LAMBDA_ZIPS_BUCKET:-}" ]]; then
  echo "Uploading layers to s3://${LAMBDA_ZIPS_BUCKET}/layers/ ..."
  aws s3 cp "${DIST}/superdoc_utils.zip" "s3://${LAMBDA_ZIPS_BUCKET}/layers/superdoc_utils.zip"
  aws s3 cp "${DIST}/python_deps.zip"    "s3://${LAMBDA_ZIPS_BUCKET}/layers/python_deps.zip"
  echo "Upload complete."
fi
