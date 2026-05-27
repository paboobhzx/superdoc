#!/usr/bin/env bash
# Build and optionally push LibreOffice Lambda container images.
#
# Usage:
#   bash scripts/build_office_images.sh
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=us-east-1 ECR_REPOSITORY=superdoc-dev-office-conversion PUSH=true bash scripts/build_office_images.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY="${ECR_REPOSITORY:-superdoc-dev-office-conversion}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/arm64}"

build_image() {
  local op="$1"
  local handler_file="handlers/${op}.py"
  local local_tag="superdoc-office-${op}:${IMAGE_TAG}"
  local remote_tag=""

  if [[ "${PUSH:-false}" == "true" ]]; then
    if [[ -z "${AWS_ACCOUNT_ID:-}" ]]; then
      AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
    fi
    remote_tag="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}:${op}-${IMAGE_TAG}"
    aws ecr get-login-password --region "${AWS_REGION}" \
      | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    docker buildx build \
      --platform "${PLATFORM}" \
      --provenance=false \
      --sbom=false \
      --file "${REPO_ROOT}/office_image/Dockerfile" \
      --build-arg "HANDLER_FILE=${handler_file}" \
      --tag "${remote_tag}" \
      --push \
      "${REPO_ROOT}"
    return
  fi

  docker buildx build \
    --platform "${PLATFORM}" \
    --provenance=false \
    --sbom=false \
    --file "${REPO_ROOT}/office_image/Dockerfile" \
    --build-arg "HANDLER_FILE=${handler_file}" \
    --tag "${local_tag}" \
    --load \
    "${REPO_ROOT}"
}

build_image docx_to_pdf
build_image xlsx_to_pdf
build_image pdf_to_docx
build_image pdf_to_xls
