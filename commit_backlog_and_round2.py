#!/usr/bin/env python3
# =============================================================================
# SuperDoc - Commits Round 1 fix + Round 2 Tasks 1-3
# =============================================================================
#
# There's a backlog of untracked/modified code from before Round 1 that should
# have been committed long ago. This script organizes everything into scoped
# commits so the git log tells a coherent story.
#
# Ordering rationale:
#   1. .gitignore first - avoids committing dumps/tfplans/bak files later
#   2. Round 1 fix (api_gateway source_arn drift) - historical context
#   3. Backend (handlers + layers + scripts) - the missing foundation
#   4. Infra modules that were always untracked (acm, sqs, lambda_layer, etc.)
#   5. Infra modifications (CloudFront /api, Amplify envs, etc.)
#   6. Frontend pages/context/tests that were untracked
#   7. Frontend modifications (api.js, App.jsx, editors)
#   8. Round 2 T1-3 as a separate, focused commit
#
# The script is interactive: shows what will be committed at each step and
# asks for confirmation. Not idempotent (git commits aren't), so running it
# twice will fail on the second commit with "nothing to commit".
#
# Usage:
#   cd /Users/pablocosta/Desktop/terraform/GitHub/superdoc
#   python3 commit_backlog_and_round2.py            # interactive
#   python3 commit_backlog_and_round2.py --yes      # skip confirmations
#   python3 commit_backlog_and_round2.py --dry-run  # show plan, commit nothing
# =============================================================================

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path.cwd()


# ---- Logging -----------------------------------------------------------------

def log(level: str, msg: str) -> None:
    colors = {"info": "\033[36m", "ok": "\033[32m", "warn": "\033[33m", "err": "\033[31m", "step": "\033[35m"}
    reset = "\033[0m"
    color = colors.get(level, "")
    print(f"{color}[commit]{reset} {msg}", flush=True)


def info(msg): log("info", msg)
def ok(msg):   log("ok", msg)
def warn(msg): log("warn", msg)
def err(msg):  log("err", msg)
def step(msg): log("step", msg)


# ---- Git helpers -------------------------------------------------------------

def run_git(args: list[str], check: bool = True, capture: bool = True):
    # Tiny wrapper so we log every git invocation consistently and fail loud.
    cmd = ["git"] + args
    info("  $ " + " ".join(cmd))
    if capture:
        result = subprocess.run(cmd, capture_output=True, text=True)
    else:
        result = subprocess.run(cmd, text=True)
    if check and result.returncode != 0:
        stderr = ""
        if capture:
            stderr = result.stderr
        raise RuntimeError(f"git {' '.join(args)} failed (rc={result.returncode})\n{stderr}")
    return result


def git_has_staged_changes() -> bool:
    # Returns True if `git diff --cached` would show anything.
    result = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        capture_output=True,
    )
    return result.returncode != 0


def git_path_exists(path: str) -> bool:
    # Only stage a path if it actually exists on disk. git add of a missing path
    # errors out; we want to soft-skip so the script stays runnable across
    # slightly different working copies.
    return (REPO_ROOT / path).exists()


# ---- Commit step -------------------------------------------------------------

def do_commit(
    title: str,
    message: str,
    paths: list[str],
    *,
    yes: bool,
    dry_run: bool,
    allow_empty: bool = False,
) -> bool:
    """Stages the given paths and commits with the given message.

    Returns True if a commit was made, False if nothing to commit.
    Skips gracefully if no paths exist or nothing is staged.
    """
    step(f"[{title}]")

    existing_paths = []
    for p in paths:
        if git_path_exists(p):
            existing_paths.append(p)
        else:
            warn(f"  skipping missing path: {p}")

    if not existing_paths and not allow_empty:
        warn(f"  no existing paths to stage for '{title}', skipping")
        return False

    # Stage.
    if dry_run:
        info(f"  [dry-run] would stage: {existing_paths}")
    else:
        # `git add -A <path>` includes deletions and modifications; use it so
        # renames/removals get picked up alongside additions.
        for p in existing_paths:
            run_git(["add", "-A", p])

    # Check if there's actually anything staged before committing.
    if not dry_run and not git_has_staged_changes():
        info(f"  nothing staged after add, skipping '{title}'")
        return False

    # Show what's about to be committed.
    if not dry_run:
        run_git(["diff", "--cached", "--stat"], capture=False)

    if not yes and not dry_run:
        reply = input(f"\n  Proceed with commit '{title}'? [y/N]: ").strip().lower()
        if reply not in ("y", "yes"):
            warn("  skipped by user")
            # Unstage what we just staged so next step starts clean.
            run_git(["reset", "HEAD", "--"] + existing_paths, check=False)
            return False

    if dry_run:
        info(f"  [dry-run] would commit: {title}")
        info(f"  [dry-run] message:\n{message}")
        return True

    full_msg = f"{title}\n\n{message}"
    run_git(["commit", "-m", full_msg])
    ok(f"  committed: {title}")
    return True


# ---- Sanity checks -----------------------------------------------------------

def ensure_repo_root() -> None:
    # Abort if not at repo root or not in a git repo.
    markers = ["handlers", "layers/superdoc_utils", "infra/main.tf", ".git"]
    missing = []
    for m in markers:
        if not (REPO_ROOT / m).exists():
            missing.append(m)
    if missing:
        err(f"not at SuperDoc repo root (missing: {missing})")
        err(f"cwd={REPO_ROOT}")
        sys.exit(2)


def ensure_clean_working_tree_after_backups() -> None:
    # Leftover .bak-round2t123 files from the deploy script would get caught by
    # `git add -A`. Warn loudly so the user deletes them first.
    baks = list(REPO_ROOT.rglob("*.bak-round2t123"))
    if baks:
        warn(f"found {len(baks)} .bak-round2t123 files - they will be ignored by .gitignore")
        warn("  (deletion is optional; gitignore handles them)")


# ---- Gitignore update --------------------------------------------------------

GITIGNORE_ADDITIONS = """
# Local dumps and plans
superdoc_dump_*.txt
*.tfplan
round2-*.tfplan

# Script backups
*.bak-round2t123
*.bak

# Terraform local state
.terraform/
.terraform.lock.hcl
*.tfstate
*.tfstate.backup

# Build artifacts
dist/
frontend/dist/
build.zip
"""


def update_gitignore() -> None:
    # Additive - we don't overwrite the existing .gitignore, just ensure our
    # essential patterns are present.
    gi = REPO_ROOT / ".gitignore"
    existing = ""
    if gi.exists():
        existing = gi.read_text()

    needed_patterns = [line.strip() for line in GITIGNORE_ADDITIONS.splitlines() if line.strip() and not line.strip().startswith("#")]
    missing = [p for p in needed_patterns if p not in existing]

    if not missing:
        info("  .gitignore already covers all patterns, no update needed")
        return

    info(f"  adding {len(missing)} patterns to .gitignore")
    new_content = existing.rstrip() + "\n" + GITIGNORE_ADDITIONS
    gi.write_text(new_content)
    ok("  .gitignore updated")


# ---- Commit plan -------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="skip y/N confirmations")
    parser.add_argument("--dry-run", action="store_true", help="show plan, commit nothing")
    args = parser.parse_args()

    ensure_repo_root()
    ensure_clean_working_tree_after_backups()

    # Show starting state.
    step("Current git status:")
    run_git(["status", "--short"], capture=False)
    print()

    if not args.yes and not args.dry_run:
        reply = input("Proceed with commit backlog? [y/N]: ").strip().lower()
        if reply not in ("y", "yes"):
            warn("aborted by user")
            return

    # ---- Step 0: .gitignore (so subsequent adds don't grab junk) ------------
    step("[0/8] Updating .gitignore")
    if not args.dry_run:
        update_gitignore()
    do_commit(
        title="chore: ignore dumps, tfplans, terraform state, and build artifacts",
        message=(
            "Adds patterns for local dumps, terraform plans (including\n"
            "round2-*.tfplan), backup files created by deploy scripts,\n"
            "terraform local state, and build artifacts."
        ),
        paths=[".gitignore"],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 1: Round 1 fix (api_gateway source_arn) -----------------------
    # This was applied in a hurry during Round 1 debugging. Committing in
    # isolation so the fix has its own entry in git log with full rationale.
    do_commit(
        title="fix(api_gateway): build execute-api ARN explicitly to avoid provider drift",
        message=(
            "The AWS provider (v5.100.0) has a drift bug where\n"
            "aws_api_gateway_rest_api.execution_arn is read as\n"
            "arn:aws:execute-api:<region>::<api_id> (empty account segment).\n"
            "That broken ARN then propagates to aws_lambda_permission.source_arn,\n"
            "which causes API Gateway to fail Lambda invocation with\n"
            "'Invalid permissions on Lambda function' and return a DEFAULT_5XX\n"
            'gateway response: {"error":" \\"Internal server error\\""}.\n'
            "\n"
            "Fix: construct the execute-api ARN explicitly using\n"
            "data.aws_caller_identity and data.aws_region, never referencing\n"
            "execution_arn directly. This is the pattern used for all eight\n"
            "aws_lambda_permission resources in the module."
        ),
        paths=["infra/modules/api_gateway/main.tf"],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 2: Backend Python (never committed before) --------------------
    do_commit(
        title="feat(backend): add Lambda handlers, shared layers, and build scripts",
        message=(
            "Introduces the complete Python backend that was previously\n"
            "untracked: 23 Lambda handlers, the superdoc_utils shared layer\n"
            "(dynamo, s3, response, rate_limit, circuit_breaker, feature_flags,\n"
            "operations, estimator, logger, retry, api_key), the python_deps\n"
            "requirements, and the build/publish scripts for both."
        ),
        paths=["handlers", "layers", "scripts"],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 3: Untracked Terraform modules --------------------------------
    do_commit(
        title="feat(infra): add missing Terraform modules (acm, lambda_layer, sqs, bootstrap)",
        message=(
            "These four modules and the bootstrap backend config were used by\n"
            "infra/main.tf but never committed. Adds them so the project can be\n"
            "cloned and deployed from a clean checkout."
        ),
        paths=[
            "infra/bootstrap_backend",
            "infra/modules/acm",
            "infra/modules/lambda_layer",
            "infra/modules/sqs",
            "infra/backend.tf.example",
        ],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 4: Infra modifications (CloudFront + Amplify + lambda wiring) -
    do_commit(
        title="feat(infra): CloudFront /api origin, Amplify Cognito envs, scoped IAM",
        message=(
            "CloudFront now has a second origin for the API Gateway invoke URL\n"
            "with a CloudFront Function that rewrites /api/* to /<stage>/*.\n"
            "Amplify receives Cognito user-pool/client IDs as env vars.\n"
            "Lambda IAM scopes are tightened to the users/* S3 prefix for\n"
            "authenticated workflows."
        ),
        paths=[
            "infra/main.tf",
            "infra/modules/amplify",
            "infra/modules/cloudfront",
            "infra/modules/cognito",
            "infra/modules/lambda",
            "infra/modules/s3",
            "infra/modules/dynamodb",
            "infra/modules/monitoring",
            "infra/modules/route53",
            "infra/modules/ssm",
            "infra/modules/budget",
            "infra/variables.tf",
            "infra/versions.tf",
            "infra/tags.tf",
            "infra/environments",
        ],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 5: Frontend untracked pages/context/tests ---------------------
    do_commit(
        title="feat(frontend): add Dashboard, Tools, editor pages, AuthContext, e2e tests",
        message=(
            "Introduces the Dashboard page, the Tools index, four document\n"
            "editor pages (PDF, DOCX, XLSX, Image), the AuthContext for Cognito\n"
            "integration, polyfills, and Playwright e2e test scaffolding."
        ),
        paths=[
            "frontend/src/context",
            "frontend/src/lib/download.js",
            "frontend/src/pages/Dashboard.jsx",
            "frontend/src/pages/DocxEditor.jsx",
            "frontend/src/pages/ImageEditor.jsx",
            "frontend/src/pages/PdfEditor.jsx",
            "frontend/src/pages/Tools.jsx",
            "frontend/src/pages/XlsxEditor.jsx",
            "frontend/src/polyfills.js",
            "frontend/tests/e2e",
            "frontend/.env.example",
            "frontend/eslint.config.js",
            "frontend/playwright.config.cjs",
        ],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 6: Frontend modifications (api client, routing) ---------------
    do_commit(
        title="refactor(frontend): remove silent /api fallback, wire editors to backend",
        message=(
            "The api client no longer falls back to ${origin}/api silently when\n"
            "VITE_API_URL is unset - it fails loudly. App.jsx imports and routes\n"
            "the new pages. Auth flows (login/register/confirm) wired to\n"
            "AuthContext."
        ),
        paths=[
            "frontend/src/lib/api.js",
            "frontend/src/App.jsx",
            "frontend/src/main.jsx",
            "frontend/src/pages/Home",
            "frontend/src/pages/Processing",
            "frontend/src/pages/auth",
            "frontend/src/tests",
            "frontend/package.json",
            "frontend/package-lock.json",
        ],
        yes=args.yes,
        dry_run=args.dry_run,
    )

    # ---- Step 7: Everything else that slipped through -----------------------
    # Catch-all so we don't leave orphan changes. If anything shows up here it
    # means our plan above missed a category; the user should review before
    # committing.
    do_commit(
        title="chore: remaining project housekeeping",
        message=(
            "Catch-all commit for README updates, miscellaneous config, and\n"
            "anything not covered by the more focused commits above. If this\n"
            "commit is large, something slipped through categorization and\n"
            "should be revisited."
        ),
        paths=["."],
        yes=args.yes,
        dry_run=args.dry_run,
        allow_empty=True,
    )

    # ---- Final state ---------------------------------------------------------
    print()
    step("Final git status (should be clean or only contain ignored files):")
    run_git(["status", "--short"], capture=False)

    print()
    step("Last 10 commits:")
    run_git(["log", "--oneline", "-n", "10"], capture=False)

    print()
    ok("Done.")
    if not args.dry_run:
        info("")
        info("Review with:  git log --oneline -n 20")
        info("Push with:    git push origin main  (when ready)")


if __name__ == "__main__":
    main()
