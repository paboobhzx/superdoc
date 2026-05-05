#!/usr/bin/env bash
set -euo pipefail

# =====================================================================
# Consolidated apply script for single environment
# =====================================================================
#
# Uso normal:
#   bash infra/apply.sh
#
# Terraform com target:
#   bash infra/apply.sh -target=module.superdoc.module.lambda_dispatch_job
#
# Pular build backend/layers:
#   SKIP_BUILD=1 bash infra/apply.sh
#   bash infra/apply.sh --skip-build
#
# Pular frontend/Amplify/CloudFront invalidation:
#   SKIP_FRONTEND=1 bash infra/apply.sh
#   bash infra/apply.sh --skip-frontend
#
# Pular tudo que é build/deploy, rodando só Terraform:
#   SKIP_BUILD=1 SKIP_FRONTEND=1 bash infra/apply.sh
#   bash infra/apply.sh --skip-build --skip-frontend
#
# Aplicar alteração explícita de CloudFront distribution config:
#   CF_CONFIG_FILE=/tmp/cf_new.json bash infra/apply.sh
#   bash infra/apply.sh --cf-config=/tmp/cf_new.json
#
# Também aceita:
#   bash infra/apply.sh SKIP_BUILD=1 SKIP_FRONTEND=1
#   bash infra/apply.sh --SKIP_BUILD=1 --SKIP_FRONTEND=1
#   bash infra/apply.sh --skip-build --skip-frontend -target=...
#
# Observação importante:
# - O update explícito do CloudFront só roda se CF_CONFIG_FILE / --cf-config
#   for informado.
# - Se o arquivo vier no formato completo:
#       { "ETag": "...", "DistributionConfig": { ... } }
#   o script extrai automaticamente apenas .DistributionConfig.
# - Se o arquivo já for apenas o DistributionConfig puro, ele usa direto.
# =====================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TERRAFORM_ARGS=()
CF_CONFIG_FILE="${CF_CONFIG_FILE:-}"

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

require_cmd() {
  local cmd="$1"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd"

    case "$cmd" in
      jq)
        echo "Install with:"
        echo "  brew install jq"
        ;;
      aws)
        echo "Install/configure AWS CLI before running this script."
        ;;
      terraform)
        echo "Install Terraform before running this script."
        ;;
      npm)
        echo "Install Node.js/npm before running this script."
        ;;
      zip)
        echo "Install zip before running this script."
        ;;
      curl)
        echo "curl is required for Amplify artifact upload."
        ;;
    esac

    exit 1
  fi
}

print_header() {
  echo
  echo "======================================================================"
  echo "$1"
  echo "======================================================================"
}

json_get() {
  python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))"
}

# ---------------------------------------------------------------------
# 0. Parse script flags
# ---------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build|-skip-build|--SKIP_BUILD|-SKIP_BUILD)
      export SKIP_BUILD=1
      shift
      ;;

    --skip-frontend|-skip-frontend|--SKIP_FRONTEND|-SKIP_FRONTEND)
      export SKIP_FRONTEND=1
      shift
      ;;

    --skip-build=1|-skip-build=1|--SKIP_BUILD=1|-SKIP_BUILD=1)
      export SKIP_BUILD=1
      shift
      ;;

    --skip-frontend=1|-skip-frontend=1|--SKIP_FRONTEND=1|-SKIP_FRONTEND=1)
      export SKIP_FRONTEND=1
      shift
      ;;

    SKIP_BUILD=1)
      export SKIP_BUILD=1
      shift
      ;;

    SKIP_FRONTEND=1)
      export SKIP_FRONTEND=1
      shift
      ;;

    CF_CONFIG_FILE=*)
      CF_CONFIG_FILE="${1#CF_CONFIG_FILE=}"
      shift
      ;;

    --cf-config=*)
      CF_CONFIG_FILE="${1#--cf-config=}"
      shift
      ;;

    -cf-config=*)
      CF_CONFIG_FILE="${1#-cf-config=}"
      shift
      ;;

    --cloudfront-config=*)
      CF_CONFIG_FILE="${1#--cloudfront-config=}"
      shift
      ;;

    *)
      TERRAFORM_ARGS+=("$1")
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------
# 1. Basic dependency checks
# ---------------------------------------------------------------------

print_header "Checking dependencies"

require_cmd aws
require_cmd jq
require_cmd terraform
require_cmd python3

if [[ "${SKIP_FRONTEND:-0}" != "1" ]]; then
  require_cmd npm
  require_cmd zip
  require_cmd curl
fi

echo "OK: dependencies available."

# ---------------------------------------------------------------------
# 2. Determine the environment directory
# ---------------------------------------------------------------------

print_header "Resolving Terraform environment"

if [[ -d "${REPO_ROOT}/infra/environments/default" ]]; then
  INFRA_ENV_DIR="${REPO_ROOT}/infra/environments/default"
elif [[ -d "${REPO_ROOT}/infra/environments/prod" ]]; then
  INFRA_ENV_DIR="${REPO_ROOT}/infra/environments/prod"
else
  echo "ERROR: No 'default' or 'prod' environment directory found under infra/environments/"
  exit 1
fi

echo "Using environment directory:"
echo "  $INFRA_ENV_DIR"

# ---------------------------------------------------------------------
# 3. Resolve Lambda zip bucket
# ---------------------------------------------------------------------

print_header "Resolving Lambda zip bucket"

LAMBDA_ZIPS_BUCKET=""

# Read from build_handlers.sh (the authoritative source).
if [[ -f "${REPO_ROOT}/scripts/build_handlers.sh" ]]; then
  LAMBDA_ZIPS_BUCKET="$(grep -oE 'LAMBDA_ZIPS_BUCKET="[^"]+"' "${REPO_ROOT}/scripts/build_handlers.sh" 2>/dev/null | head -n1 | cut -d'"' -f2 || true)"
fi

# Final fallback.
if [[ -z "$LAMBDA_ZIPS_BUCKET" ]]; then
  LAMBDA_ZIPS_BUCKET="superdoc-lambda-zips-288854271409"
fi

echo "Using Lambda zip bucket:"
echo "  $LAMBDA_ZIPS_BUCKET"

export TF_VAR_lambda_handler_s3_bucket="$LAMBDA_ZIPS_BUCKET"

# ---------------------------------------------------------------------
# 4. Fetch GitHub PAT from SSM for Amplify/Terraform
# ---------------------------------------------------------------------

print_header "Fetching GitHub token from SSM"

export TF_VAR_amplify_oauth_token

TF_VAR_amplify_oauth_token="$(aws ssm get-parameter \
  --name "/superdoc/github/access_token" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text)"

if [[ -z "$TF_VAR_amplify_oauth_token" || "$TF_VAR_amplify_oauth_token" == "None" ]]; then
  echo "ERROR: could not fetch GitHub token from SSM."
  echo "Expected parameter:"
  echo "  /superdoc/github/access_token"
  exit 1
fi

echo "Token loaded:"
echo "  ${TF_VAR_amplify_oauth_token:0:12}... length=${#TF_VAR_amplify_oauth_token}"

# ---------------------------------------------------------------------
# 5. Backend build + sync to S3
# ---------------------------------------------------------------------

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  print_header "Building backend handlers and layers"

  echo "Building handlers..."
  bash "${REPO_ROOT}/scripts/build_handlers.sh"

  echo "Building layers..."
  bash "${REPO_ROOT}/scripts/build_layers.sh"

  echo "Syncing handler zips to S3..."
  aws s3 sync \
    "${REPO_ROOT}/dist/handlers/" \
    "s3://${LAMBDA_ZIPS_BUCKET}/handlers/" \
    --no-progress

  echo "Syncing layer zips to S3..."
  aws s3 sync \
    "${REPO_ROOT}/dist/layers/" \
    "s3://${LAMBDA_ZIPS_BUCKET}/layers/" \
    --no-progress

  echo "Backend build/sync completed."
else
  print_header "Skipping backend build"
  echo "SKIP_BUILD=1 detected. Skipping handlers, layers and S3 sync."
fi

# ---------------------------------------------------------------------
# 6. Terraform apply
# ---------------------------------------------------------------------

print_header "Running Terraform apply"

echo "Terraform directory:"
echo "  $INFRA_ENV_DIR"

if [[ ${#TERRAFORM_ARGS[@]} -gt 0 ]]; then
  echo "Extra Terraform args:"
  printf '  %q\n' "${TERRAFORM_ARGS[@]}"
else
  echo "Extra Terraform args:"
  echo "  none"
fi

terraform -chdir="${INFRA_ENV_DIR}" apply -auto-approve ${TERRAFORM_ARGS[@]+"${TERRAFORM_ARGS[@]}"}

echo "Terraform apply completed."

# ---------------------------------------------------------------------
# 7. Read Terraform outputs
# ---------------------------------------------------------------------

print_header "Reading Terraform outputs"

APP_ID=""
CF_DIST_ID=""

if terraform -chdir="${INFRA_ENV_DIR}" output -raw amplify_app_id >/tmp/apply_amplify_app_id.out 2>/tmp/apply_amplify_app_id.err; then
  APP_ID="$(cat /tmp/apply_amplify_app_id.out)"
else
  echo "WARN: Could not read Terraform output: amplify_app_id"
  echo "      Frontend deploy will fail unless SKIP_FRONTEND=1."
fi

if terraform -chdir="${INFRA_ENV_DIR}" output -raw cloudfront_distribution_id >/tmp/apply_cf_dist_id.out 2>/tmp/apply_cf_dist_id.err; then
  CF_DIST_ID="$(cat /tmp/apply_cf_dist_id.out)"
else
  echo "WARN: Could not read Terraform output: cloudfront_distribution_id"
  echo "      CloudFront update/invalidation will be skipped if no distribution ID is available."
fi

echo "Amplify app ID:"
echo "  ${APP_ID:-not found}"

echo "CloudFront distribution ID:"
echo "  ${CF_DIST_ID:-not found}"

rm -f /tmp/apply_amplify_app_id.out /tmp/apply_amplify_app_id.err
rm -f /tmp/apply_cf_dist_id.out /tmp/apply_cf_dist_id.err

# ---------------------------------------------------------------------
# 8. Optional explicit CloudFront distribution update
# ---------------------------------------------------------------------

update_cloudfront_distribution_config() {
  local dist_id="$1"
  local input_file="$2"

  if [[ -z "$dist_id" ]]; then
    echo "ERROR: CloudFront distribution ID is empty."
    exit 1
  fi

  if [[ -z "$input_file" ]]; then
    echo "ERROR: CloudFront config file is empty."
    exit 1
  fi

  if [[ ! -f "$input_file" ]]; then
    echo "ERROR: CloudFront config file not found:"
    echo "  $input_file"
    exit 1
  fi

  local ts
  ts="$(date +%Y%m%d-%H%M%S)"

  local workdir
  workdir="/tmp/cloudfront-update-${dist_id}-${ts}"

  local full_config
  local current_config
  local final_config
  local update_output

  full_config="${workdir}/cf_full.json"
  current_config="${workdir}/cf_distribution_config_current.json"
  final_config="${workdir}/cf_distribution_config_final.json"
  update_output="${workdir}/cf_update_output.json"

  mkdir -p "$workdir"

  print_header "Updating CloudFront distribution config"

  echo "Distribution ID:"
  echo "  $dist_id"
  echo "Input file:"
  echo "  $input_file"
  echo "Workdir:"
  echo "  $workdir"

  echo
  echo "Fetching current CloudFront distribution config..."

  aws cloudfront get-distribution-config \
    --id "$dist_id" \
    > "$full_config"

  local etag
  etag="$(jq -r '.ETag' "$full_config")"

  if [[ -z "$etag" || "$etag" == "null" ]]; then
    echo "ERROR: could not extract CloudFront ETag."
    exit 1
  fi

  jq '.DistributionConfig' "$full_config" > "$current_config"

  echo "Current ETag:"
  echo "  $etag"

  echo
  echo "Validating input JSON..."
  jq empty "$input_file"

  local has_distribution_config
  local has_etag

  has_distribution_config="$(jq 'has("DistributionConfig")' "$input_file")"
  has_etag="$(jq 'has("ETag")' "$input_file")"

  if [[ "$has_distribution_config" == "true" ]]; then
    echo "Detected full get-distribution-config format."
    echo "Extracting only .DistributionConfig..."
    jq '.DistributionConfig' "$input_file" > "$final_config"

    if [[ "$has_etag" == "true" ]]; then
      local file_etag
      file_etag="$(jq -r '.ETag' "$input_file")"

      echo
      echo "Input file also contains ETag:"
      echo "  $file_etag"
      echo
      echo "Using freshly fetched ETag instead:"
      echo "  $etag"
    fi
  else
    echo "Input file appears to already be a pure DistributionConfig."
    cp "$input_file" "$final_config"
  fi

  echo
  echo "Validating final CloudFront DistributionConfig..."
  jq empty "$final_config"

  local required_fields
  required_fields=(
    "CallerReference"
    "Origins"
    "DefaultCacheBehavior"
    "Comment"
    "Enabled"
  )

  local field
  for field in "${required_fields[@]}"; do
    local exists
    exists="$(jq --arg field "$field" 'has($field)' "$final_config")"

    if [[ "$exists" != "true" ]]; then
      echo "ERROR: required field missing in DistributionConfig:"
      echo "  $field"
      echo
      echo "Final config:"
      echo "  $final_config"
      exit 1
    fi
  done

  if jq 'has("ETag") or has("DistributionConfig")' "$final_config" | grep -q true; then
    echo "ERROR: final config still contains ETag or DistributionConfig at root level."
    echo "CloudFront update-distribution expects only the inner DistributionConfig object."
    echo
    echo "Final config:"
    echo "  $final_config"
    exit 1
  fi

  echo "CloudFront config validation OK."

  echo
  echo "Summary before update:"

  echo
  echo "Aliases:"
  jq -r '
    if .Aliases.Quantity > 0 then
      .Aliases.Items[]?
    else
      "(no aliases)"
    end
  ' "$final_config"

  echo
  echo "Origins:"
  jq -r '
    .Origins.Items[]? |
    "- Id: \(.Id) | DomainName: \(.DomainName)"
  ' "$final_config"

  echo
  echo "DefaultRootObject:"
  jq -r '.DefaultRootObject // "(not set)"' "$final_config"

  echo
  echo "Enabled:"
  jq -r '.Enabled' "$final_config"

  echo
  echo "Comment:"
  jq -r '.Comment' "$final_config"

  echo
  echo "Sending CloudFront update-distribution..."

  aws cloudfront update-distribution \
    --id "$dist_id" \
    --if-match "$etag" \
    --distribution-config "file://${final_config}" \
    > "$update_output"

  echo
  echo "CloudFront update submitted."
  echo "Output saved at:"
  echo "  $update_output"

  echo
  echo "CloudFront update summary:"
  jq '{
    Id: .Distribution.Id,
    Status: .Distribution.Status,
    DomainName: .Distribution.DomainName,
    LastModifiedTime: .Distribution.LastModifiedTime,
    ETag: .ETag,
    Enabled: .Distribution.DistributionConfig.Enabled,
    Aliases: .Distribution.DistributionConfig.Aliases
  }' "$update_output"

  echo
  echo "Generated files:"
  echo "  Full original config:       $full_config"
  echo "  Current DistributionConfig: $current_config"
  echo "  Sent DistributionConfig:    $final_config"
  echo "  Update output:              $update_output"
}

if [[ -n "$CF_CONFIG_FILE" ]]; then
  update_cloudfront_distribution_config "$CF_DIST_ID" "$CF_CONFIG_FILE"
else
  print_header "Skipping explicit CloudFront distribution update"
  echo "No CF_CONFIG_FILE / --cf-config provided."
fi

# ---------------------------------------------------------------------
# 9. Frontend build + Amplify deploy + CloudFront invalidation
# ---------------------------------------------------------------------

if [[ "${SKIP_FRONTEND:-0}" != "1" ]]; then
  print_header "Deploying frontend"

  if [[ -z "$APP_ID" ]]; then
    echo "ERROR: Amplify app ID not found."
    echo "Terraform output expected:"
    echo "  amplify_app_id"
    exit 1
  fi

  # Detect whether the app is repo-connected (GitHub auto-build) or manual deploy.
  AMPLIFY_REPO="$(aws amplify get-app \
    --app-id "$APP_ID" \
    --query "app.repository" \
    --output text 2>/dev/null || echo "")"

  if [[ -n "$AMPLIFY_REPO" && "$AMPLIFY_REPO" != "None" ]]; then
    # ----------------------------------------------------------------
    # Repo-connected mode: Amplify builds from GitHub source.
    # Trigger a RELEASE job instead of uploading a local zip.
    # ----------------------------------------------------------------
    echo "App is connected to GitHub:"
    echo "  $AMPLIFY_REPO"
    echo
    echo "Triggering Amplify RELEASE build..."

    RELEASE_JOB="$(aws amplify start-job \
      --app-id "$APP_ID" \
      --branch-name main \
      --job-type RELEASE \
      --output json)"

    JOB_ID="$(echo "$RELEASE_JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobSummary']['jobId'])")"
    JOB_STATUS="$(echo "$RELEASE_JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobSummary']['status'])")"

    echo "Build triggered:"
    echo "  job: $JOB_ID  status: $JOB_STATUS"
    echo
    echo "Amplify will build and deploy from the main branch."
    echo "Monitor progress in the Amplify console or run:"
    echo "  aws amplify get-job --app-id $APP_ID --branch-name main --job-id $JOB_ID"

  else
    # ----------------------------------------------------------------
    # Manual deploy mode: build locally and upload zip to Amplify.
    # ----------------------------------------------------------------
    echo "App is in manual deploy mode (no GitHub repo connected)."
    echo
    echo "Reading VITE_* env vars from Amplify..."
    echo "Amplify app ID:"
    echo "  $APP_ID"

    AMPLIFY_ENV="$(aws amplify get-app \
      --app-id "$APP_ID" \
      --query "app.environmentVariables" \
      --output json)"

    VITE_API_URL="$(echo "$AMPLIFY_ENV" | json_get "VITE_API_URL")"
    VITE_COGNITO_POOL="$(echo "$AMPLIFY_ENV" | json_get "VITE_COGNITO_USER_POOL_ID")"
    VITE_COGNITO_CLIENT="$(echo "$AMPLIFY_ENV" | json_get "VITE_COGNITO_CLIENT_ID")"
    VITE_ENV_VAR="$(echo "$AMPLIFY_ENV" | python3 -c "import sys,json; print(json.load(sys.stdin).get('VITE_ENV','prod'))")"

    echo "Frontend env:"
    echo "  VITE_API_URL=$VITE_API_URL"
    echo "  VITE_ENV=$VITE_ENV_VAR"
    echo "  VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_POOL"
    echo "  VITE_COGNITO_CLIENT_ID=${VITE_COGNITO_CLIENT:0:8}..."

    echo
    echo "Building frontend..."
    (
      cd "${REPO_ROOT}/frontend"

      npm ci --prefer-offline --silent

      VITE_API_URL="$VITE_API_URL" \
      VITE_ENV="$VITE_ENV_VAR" \
      VITE_COGNITO_USER_POOL_ID="$VITE_COGNITO_POOL" \
      VITE_COGNITO_CLIENT_ID="$VITE_COGNITO_CLIENT" \
      npm run build
    )

    echo
    echo "Zipping frontend dist..."

    DEPLOY_ZIP="/tmp/superdoc-deploy.zip"
    rm -f "$DEPLOY_ZIP"

    (
      cd "${REPO_ROOT}/frontend/dist"
      zip -r "$DEPLOY_ZIP" . -q
    )

    echo "Creating Amplify deployment..."

    DEPLOYMENT="$(aws amplify create-deployment \
      --app-id "$APP_ID" \
      --branch-name main \
      --output json)"

    JOB_ID="$(echo "$DEPLOYMENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")"
    ZIP_URL="$(echo "$DEPLOYMENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['zipUploadUrl'])")"

    echo "Uploading build artifact..."
    echo "Amplify job:"
    echo "  $JOB_ID"

    curl -s -T "$DEPLOY_ZIP" "$ZIP_URL"

    echo
    echo "Starting Amplify deployment..."

    aws amplify start-deployment \
      --app-id "$APP_ID" \
      --branch-name main \
      --job-id "$JOB_ID" \
      --output json \
      | python3 -c "import sys,json; j=json.load(sys.stdin)['jobSummary']; print(f\"  status: {j['status']}  job: {j['jobId']}\")"

    rm -f "$DEPLOY_ZIP"

    echo
    echo "Frontend deployed to Amplify."
    echo "Amplify job:"
    echo "  $JOB_ID"
  fi

  if [[ -n "$CF_DIST_ID" ]]; then
    print_header "Invalidating CloudFront cache"

    echo "Distribution:"
    echo "  $CF_DIST_ID"

    INVALIDATION_ID="$(aws cloudfront create-invalidation \
      --distribution-id "$CF_DIST_ID" \
      --paths "/*" \
      --query "Invalidation.Id" \
      --output text)"

    echo "Invalidation submitted:"
    echo "  $INVALIDATION_ID"
  else
    echo
    echo "WARN: CloudFront distribution ID not found."
    echo "Skipping invalidation."
  fi
else
  print_header "Skipping frontend deploy"
  echo "SKIP_FRONTEND=1 detected. Skipping Amplify deploy and CloudFront invalidation."
fi

# ---------------------------------------------------------------------
# 10. Final status
# ---------------------------------------------------------------------

print_header "All done"

echo "Summary:"
echo "  Repo root:        $REPO_ROOT"
echo "  Terraform env:   $INFRA_ENV_DIR"
echo "  Lambda bucket:   $LAMBDA_ZIPS_BUCKET"
echo "  Amplify app ID:  ${APP_ID:-not found}"
echo "  CloudFront ID:   ${CF_DIST_ID:-not found}"
echo "  SKIP_BUILD:      ${SKIP_BUILD:-0}"
echo "  SKIP_FRONTEND:   ${SKIP_FRONTEND:-0}"
echo "  CF_CONFIG_FILE:  ${CF_CONFIG_FILE:-not provided}"

echo
echo "Done."