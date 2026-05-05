#!/usr/bin/env bash
# Consolidated apply script for single environment (no dev/prod separation)
#
# Usage:
#   bash infra/apply.sh
#   bash infra/apply.sh -target=module.superdoc.module.lambda_list_operations
#   SKIP_BUILD=1 bash infra/apply.sh -target=module.superdoc.module.lambda_dispatch_job
#   SKIP_FRONTEND=1 bash infra/apply.sh   # skip frontend build + Amplify deploy
#   SKIP_BUILD=1 SKIP_FRONTEND=1 bash infra/apply.sh -target=...  # terraform only
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ----------------------------------------------------------------------
# 1. Determine the environment directory (single env only)
# ----------------------------------------------------------------------
if [[ -d "${REPO_ROOT}/infra/environments/default" ]]; then
  INFRA_ENV_DIR="${REPO_ROOT}/infra/environments/default"
elif [[ -d "${REPO_ROOT}/infra/environments/prod" ]]; then
  INFRA_ENV_DIR="${REPO_ROOT}/infra/environments/prod"
else
  echo "ERROR: No 'default' or 'prod' environment directory found under infra/environments/"
  exit 1
fi
echo "==> Using environment directory: $INFRA_ENV_DIR"

# ----------------------------------------------------------------------
# 2. Extract the Lambda zip bucket name (same as used by build scripts)
# ----------------------------------------------------------------------
LAMBDA_ZIPS_BUCKET=$(grep -oP 'LAMBDA_ZIPS_BUCKET="\K[^"]+' "$REPO_ROOT/infra/apply.sh" 2>/dev/null || echo "")
if [[ -z "$LAMBDA_ZIPS_BUCKET" ]]; then
  # Fallback to the one used in scripts/build_handlers.sh
  LAMBDA_ZIPS_BUCKET=$(grep -oP 'LAMBDA_ZIPS_BUCKET="\K[^"]+' "$REPO_ROOT/scripts/build_handlers.sh" 2>/dev/null || echo "superdoc-lambda-zips-288854271409")
fi
echo "==> Using Lambda zip bucket: $LAMBDA_ZIPS_BUCKET"

# ----------------------------------------------------------------------
# 3. Export the variable so Terraform picks it up
# ----------------------------------------------------------------------
export TF_VAR_lambda_handler_s3_bucket="$LAMBDA_ZIPS_BUCKET"

# ----------------------------------------------------------------------
# 4. Optionally skip building (if SKIP_BUILD=1)
# ----------------------------------------------------------------------
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building handlers..."
  bash "${REPO_ROOT}/scripts/build_handlers.sh"

  echo "==> Building layers..."
  bash "${REPO_ROOT}/scripts/build_layers.sh"

  echo "==> Syncing handler zips to S3..."
  aws s3 sync "${REPO_ROOT}/dist/handlers/" "s3://${LAMBDA_ZIPS_BUCKET}/handlers/" --no-progress

  echo "==> Syncing layer zips to S3..."
  aws s3 sync "${REPO_ROOT}/dist/layers/" "s3://${LAMBDA_ZIPS_BUCKET}/layers/" --no-progress
else
  echo "==> SKIP_BUILD=1, skipping rebuild and S3 sync"
fi

# ----------------------------------------------------------------------
# 5. Run terraform apply
# ----------------------------------------------------------------------
echo "==> Running terraform apply from ${INFRA_ENV_DIR}..."
# Pass any extra arguments (like -target=...) to terraform
terraform -chdir="${INFRA_ENV_DIR}" apply -auto-approve "$@"

# ----------------------------------------------------------------------
# 6. Build frontend and deploy to Amplify
# ----------------------------------------------------------------------
if [[ "${SKIP_FRONTEND:-0}" != "1" ]]; then
  echo "==> Reading deploy targets from terraform outputs..."
  APP_ID=$(terraform -chdir="${INFRA_ENV_DIR}" output -raw amplify_app_id)
  CF_DIST_ID=$(terraform -chdir="${INFRA_ENV_DIR}" output -raw cloudfront_distribution_id)

  echo "==> Reading VITE_* env vars from Amplify (app ID: $APP_ID)..."
  AMPLIFY_ENV=$(aws amplify get-app --app-id "$APP_ID" --query "app.environmentVariables" --output json)
  VITE_API_URL=$(echo "$AMPLIFY_ENV"        | python3 -c "import sys,json; print(json.load(sys.stdin).get('VITE_API_URL',''))")
  VITE_COGNITO_POOL=$(echo "$AMPLIFY_ENV"   | python3 -c "import sys,json; print(json.load(sys.stdin).get('VITE_COGNITO_USER_POOL_ID',''))")
  VITE_COGNITO_CLIENT=$(echo "$AMPLIFY_ENV" | python3 -c "import sys,json; print(json.load(sys.stdin).get('VITE_COGNITO_CLIENT_ID',''))")
  VITE_ENV_VAR=$(echo "$AMPLIFY_ENV"        | python3 -c "import sys,json; print(json.load(sys.stdin).get('VITE_ENV','prod'))")

  echo "    VITE_API_URL=$VITE_API_URL"
  echo "    VITE_ENV=$VITE_ENV_VAR"

  echo "==> Building frontend with prod env vars..."
  (
    cd "${REPO_ROOT}/frontend"
    npm ci --prefer-offline --silent
    VITE_API_URL="$VITE_API_URL" \
    VITE_ENV="$VITE_ENV_VAR" \
    VITE_COGNITO_USER_POOL_ID="$VITE_COGNITO_POOL" \
    VITE_COGNITO_CLIENT_ID="$VITE_COGNITO_CLIENT" \
    npm run build
  )

  echo "==> Zipping frontend dist..."
  DEPLOY_ZIP="/tmp/superdoc-deploy.zip"
  rm -f "$DEPLOY_ZIP"
  (cd "${REPO_ROOT}/frontend/dist" && zip -r "$DEPLOY_ZIP" . -q)

  echo "==> Creating Amplify deployment..."
  DEPLOYMENT=$(aws amplify create-deployment \
    --app-id "$APP_ID" \
    --branch-name main \
    --output json)
  JOB_ID=$(echo "$DEPLOYMENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")
  ZIP_URL=$(echo "$DEPLOYMENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['zipUploadUrl'])")

  echo "==> Uploading build artifact (job $JOB_ID)..."
  curl -s -T "$DEPLOY_ZIP" "$ZIP_URL"

  echo "==> Starting Amplify deployment..."
  aws amplify start-deployment \
    --app-id "$APP_ID" \
    --branch-name main \
    --job-id "$JOB_ID" \
    --output json \
    | python3 -c "import sys,json; j=json.load(sys.stdin)['jobSummary']; print(f'    status: {j[\"status\"]}  job: {j[\"jobId\"]}')"

  rm -f "$DEPLOY_ZIP"
  echo "==> Frontend deployed to Amplify (job $JOB_ID)."

  # Invalidate CloudFront so the new index.html is served immediately.
  # Without this, users see the cached old HTML for up to max_ttl seconds.
  echo "==> Invalidating CloudFront cache (distribution: $CF_DIST_ID)..."
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$CF_DIST_ID" \
    --paths "/*" \
    --query "Invalidation.Id" \
    --output text)
  echo "    Invalidation $INVALIDATION_ID submitted (propagates in ~30s)."
else
  echo "==> SKIP_FRONTEND=1, skipping frontend build, Amplify deploy and CF invalidation"
fi

echo "==> All done."