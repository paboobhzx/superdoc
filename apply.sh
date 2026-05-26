#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SSM_PARAM_NAME="/superdoc/github/access_token"
SSM_PARAM_ARN="arn:aws:ssm:us-east-1:288854271409:parameter/superdoc/github/access_token"

usage() {
  cat <<'EOF'
Usage:
  ./apply.sh -m "Commit message"

What this script does:
  1) Ensures a GitHub token is available (env or SSM)
  2) Commits and pushes current git changes
  3) Runs Terraform apply flow in infra/ (init, plan, apply)
EOF
}

COMMIT_MESSAGE=""
while getopts ":m:h" opt; do
  case "$opt" in
    m) COMMIT_MESSAGE="$OPTARG" ;;
    h)
      usage
      exit 0
      ;;
    :)
      echo "Error: Option -$OPTARG requires an argument."
      usage
      exit 1
      ;;
    \?)
      echo "Error: Invalid option -$OPTARG"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${COMMIT_MESSAGE}" ]]; then
  echo "Error: Commit message is required."
  usage
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is not installed."
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI is not installed."
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN not set; retrieving token from SSM Parameter Store..."
  GITHUB_TOKEN="$(aws ssm get-parameter \
    --name "$SSM_PARAM_NAME" \
    --with-decryption \
    --region us-east-1 \
    --query 'Parameter.Value' \
    --output text)"
  if [[ -z "${GITHUB_TOKEN}" || "${GITHUB_TOKEN}" == "None" ]]; then
    echo "Error: Could not retrieve GitHub token from SSM."
    echo "Checked: ${SSM_PARAM_NAME}"
    echo "Reference ARN: ${SSM_PARAM_ARN}"
    exit 1
  fi
fi
export GITHUB_TOKEN

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: Current directory is not a git repository."
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "Error: Detached HEAD detected. Checkout a branch before running apply.sh."
  exit 1
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "No local changes to commit."
else
  git add -A
  git commit -m "$COMMIT_MESSAGE"
fi

echo "Pushing branch '$BRANCH'..."
git push origin "$BRANCH"

echo "Git push completed."
echo "Running Terraform via infra/apply.sh..."

if [[ ! -x "infra/apply.sh" ]]; then
  echo "Error: infra/apply.sh not found or not executable."
  exit 1
fi

# Reuse token already loaded here. infra/apply.sh will also resolve
# TF_VAR_lambda_handler_s3_bucket automatically and run non-interactive apply.
bash infra/apply.sh

echo "Terraform apply flow completed."
