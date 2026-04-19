#!/usr/bin/env bash
# ============================================================
# SuperDoc Master Dump Script — Round 8
# Run from project root (the folder that contains infra/, handlers/, frontend/)
# Output: 4 dump files in the CURRENT folder
# Usage: bash full_dump.sh
# ============================================================
set -euo pipefail

ROOT="$(pwd)"
TS="$(date +%Y-%m-%d_%H-%M-%S)"

FRONTEND_OUT="$ROOT/superdoc_dump_frontend_${TS}.txt"
LOGIC_OUT="$ROOT/superdoc_dump_logic_data_${TS}.txt"
INFRA_OUT="$ROOT/superdoc_dump_infrastructure_${TS}.txt"
CONFIGS_OUT="$ROOT/superdoc_dump_configs_scripts_${TS}.txt"

SEP="################################################################################"

# ── Helpers ──────────────────────────────────────────────────────────────────
dump_file() {
  local f="$1"
  local out="$2"

  # Skip files that disappear between find and cat (race-safe, never fail-loud here)
  [ -f "$f" ] || return 0

  {
    echo "$SEP"
    echo "FILE: ${f#$ROOT/}"
    echo "LOCATION: $f"
    echo "$SEP"
    echo ""
    cat "$f"
    echo ""
    echo ""
  } >> "$out"
}

header() {
  {
    echo "SUPERDOC DUMP — $1"
    echo "Generated: $(date)"
    echo "Root: $ROOT"
    echo ""
  } > "$2"
}

# Count how many "FILE:" sections the dump got. Empty dumps = misconfigured paths.
count_entries() {
  grep -c '^FILE: ' "$1" 2>/dev/null || echo 0
}

# Resolve the first existing path from a list, prints it; returns 1 if none found.
first_existing() {
  for p in "$@"; do
    [ -d "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

# ── Path resolution (handles legacy `terraform/` layout too, just in case) ──
INFRA_DIR="$(first_existing "$ROOT/infra" "$ROOT/terraform")" || INFRA_DIR=""
HANDLERS_DIR="$(first_existing "$ROOT/handlers")" || HANDLERS_DIR=""
LAYERS_DIR="$(first_existing "$ROOT/layers")" || LAYERS_DIR=""
TESTS_DIR="$(first_existing "$ROOT/tests")" || TESTS_DIR=""
FRONTEND_SRC="$(first_existing "$ROOT/frontend/src")" || FRONTEND_SRC=""
DOCS_DIR="$(first_existing "$ROOT/docs")" || DOCS_DIR=""

echo "Starting SuperDoc dump..."
echo "  frontend/src : ${FRONTEND_SRC:-<missing>}"
echo "  handlers     : ${HANDLERS_DIR:-<missing>}"
echo "  layers       : ${LAYERS_DIR:-<missing>}"
echo "  infra        : ${INFRA_DIR:-<missing>}"
echo "  tests        : ${TESTS_DIR:-<missing>}"
echo "  docs         : ${DOCS_DIR:-<missing>}"
echo ""

# ── 1. FRONTEND ──────────────────────────────────────────────────────────────
header "FRONTEND" "$FRONTEND_OUT"

if [ -n "$FRONTEND_SRC" ]; then
  find "$FRONTEND_SRC" \
    -type d \( -name node_modules -o -name dist -o -name .git -o -name coverage \) -prune -o \
    -type f \( -name "*.jsx" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.css" -o -name "*.json" \) \
    -print | sort | while read -r f; do
      dump_file "$f" "$FRONTEND_OUT"
    done
fi

# Playwright / e2e tests (often live at frontend/tests/e2e)
if [ -d "$ROOT/frontend/tests" ]; then
  find "$ROOT/frontend/tests" \
    -type d \( -name node_modules -o -name dist -o -name .git \) -prune -o \
    -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" \) \
    -print | sort | while read -r f; do
      dump_file "$f" "$FRONTEND_OUT"
    done
fi

# ── 2. LAMBDA / LOGIC (handlers + shared layers + python tests) ─────────────
header "LAMBDA / LOGIC" "$LOGIC_OUT"

for d in "$HANDLERS_DIR" "$LAYERS_DIR" "$TESTS_DIR"; do
  [ -z "$d" ] && continue
  find "$d" \
    -type d \( -name __pycache__ -o -name .pytest_cache -o -name .venv -o -name venv -o -name node_modules \) -prune -o \
    -type f \( -name "*.py" -o -name "requirements*.txt" -o -name "pyproject.toml" -o -name "conftest.py" \) \
    -print | sort | while read -r f; do
      dump_file "$f" "$LOGIC_OUT"
    done
done

# ── 3. INFRASTRUCTURE (Terraform + env tfvars) ───────────────────────────────
header "TERRAFORM INFRASTRUCTURE" "$INFRA_OUT"

if [ -n "$INFRA_DIR" ]; then
  find "$INFRA_DIR" \
    -type d \( -name .terraform -o -name .terragrunt-cache \) -prune -o \
    -type f \( -name "*.tf" -o -name "*.tfvars" -o -name "*.tfvars.example" -o -name "*.hcl" \) \
    -print | sort | while read -r f; do
      dump_file "$f" "$INFRA_OUT"
    done
fi

# ── 4. CONFIGS / SCRIPTS / DOCS / ROOT ──────────────────────────────────────
header "CONFIGS AND SCRIPTS" "$CONFIGS_OUT"

# Shell scripts, env examples, Makefiles anywhere outside ignore-list
find "$ROOT" \
  -type d \( -name node_modules -o -name .terraform -o -name .git -o -name dist -o -name coverage -o -name __pycache__ \) -prune -o \
  -type f \( -name "*.sh" -o -name "*.env*" -o -name "Makefile" -o -name "makefile" \) \
  -print | sort | while read -r f; do
    dump_file "$f" "$CONFIGS_OUT"
  done

# Specific config / entry files (only if they exist)
for f in \
  "$ROOT/CLAUDE.md" \
  "$ROOT/README.md" \
  "$ROOT/AGENTS.md" \
  "$ROOT/frontend/vite.config.js" \
  "$ROOT/frontend/vite.config.ts" \
  "$ROOT/frontend/playwright.config.js" \
  "$ROOT/frontend/playwright.config.ts" \
  "$ROOT/frontend/package.json" \
  "$ROOT/frontend/tailwind.config.js" \
  "$ROOT/frontend/postcss.config.js" \
  "$ROOT/frontend/index.html" \
  "$ROOT/frontend/.env.example" \
  "$ROOT/frontend/.env" \
  "$ROOT/frontend/.env.local" \
  "$ROOT/frontend/.env.production" \
  "$ROOT/infra/terraform.tfvars" \
  "$ROOT/infra/terraform.tfvars.example" \
  "$ROOT/infra/variables.tf" \
  "$ROOT/terraform/terraform.tfvars" \
  "$ROOT/terraform/variables.tf" \
  "$ROOT/.env"; do
  [ -f "$f" ] && dump_file "$f" "$CONFIGS_OUT"
done

# Docs folder (markdown only — cheap and useful for agents)
if [ -n "$DOCS_DIR" ]; then
  find "$DOCS_DIR" \
    -type f \( -name "*.md" -o -name "*.mdx" \) \
    -print | sort | while read -r f; do
      dump_file "$f" "$CONFIGS_OUT"
    done
fi

# ── Summary & fail-loud on empty dumps ──────────────────────────────────────
echo ""
echo "Dump complete."
echo "Generated files:"
ls -lh "$FRONTEND_OUT" "$LOGIC_OUT" "$INFRA_OUT" "$CONFIGS_OUT"

FE_COUNT=$(count_entries "$FRONTEND_OUT")
LOGIC_COUNT=$(count_entries "$LOGIC_OUT")
INFRA_COUNT=$(count_entries "$INFRA_OUT")
CFG_COUNT=$(count_entries "$CONFIGS_OUT")

echo ""
echo "Entries per dump:"
printf "  frontend       : %s\n" "$FE_COUNT"
printf "  logic (python) : %s\n" "$LOGIC_COUNT"
printf "  infrastructure : %s\n" "$INFRA_COUNT"
printf "  configs/scripts: %s\n" "$CFG_COUNT"

WARN=0
[ "$FE_COUNT"    = "0" ] && { echo "WARN: frontend dump is empty — is frontend/src/ missing?"; WARN=1; }
[ "$LOGIC_COUNT" = "0" ] && { echo "WARN: logic dump is empty — is handlers/ or layers/ missing?"; WARN=1; }
[ "$INFRA_COUNT" = "0" ] && { echo "WARN: infrastructure dump is empty — is infra/ missing?"; WARN=1; }
[ "$CFG_COUNT"   = "0" ] && { echo "WARN: configs dump is empty — no .sh / .env / configs found?"; WARN=1; }

if [ "$WARN" = "1" ]; then
  echo ""
  echo "Some dumps look empty. Double-check you are running this from the project root"
  echo "(the folder that contains the infra/, handlers/, frontend/ directories)."
  exit 1
fi
