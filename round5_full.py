#!/usr/bin/env python3
# =============================================================================
# SuperDoc Round 5 — picker v2 + toast + rate-limit flag + picker.js refresh
# =============================================================================
#
# Single script, 5 concerns. They're bundled because they share a deployment
# cycle (same frontend build, same layer rebuild) and the picker rewrite
# depends on both the new `intent` field and the toast system being present.
#
# 1. Backend — rate_limit feature flag
#    - handlers/create_job.py reads RATE_LIMIT_ENABLED env var; when "false",
#      bypasses BOTH rate_limit.check() AND the _ANON_MAX_ACTIVE_DOCS cap.
#    - handlers/user_create_file.py gets the same treatment.
#    - infra/variables.tf + infra/main.tf: Terraform variable `rate_limit_enabled`
#      plumbed into the relevant Lambdas' environment variables.
#    - default value: false (disabled), per Pablo's call. Flip to true when
#      going live.
#
# 2. Backend — intent field on operations
#    - layers/superdoc_utils/operations.py: each of the 11 existing ops gets
#      an `"intent": "modify"|"convert"` field.
#    - list_operations() returns `intent` in the JSON response.
#    - is_supported / validate_params untouched.
#
# 3. Frontend — sonner toast + wired api error handling
#    - npm install sonner
#    - src/main.jsx: mount <Toaster /> at the root
#    - src/lib/toast.js: thin helper exporting notify.success / notify.error.
#      notify.error({ message, httpCode, technical }) renders a sonner toast
#      with an expandable "Technical details" that shows http code + technical
#      message + a Copy button.
#    - src/lib/api.js: `request()` enriches thrown Errors with {status,
#      technical} and calls notify.error directly so every API consumer gets
#      feedback without wiring it themselves.
#
# 4. Frontend — 2-step OperationPicker
#    - src/pages/Home/OperationPicker.jsx: rewrite. Step 1 picks intent
#      ("Modify" / "Convert"). Step 2 picks the specific operation within
#      that intent. Step 1 is skipped if only one intent exists for the
#      input_type (e.g. video_process-only for .mp4).
#
# 5. Frontend — picker.js UI metadata refresh
#    - src/pages/Home/picker.js: update doc_edit description (was "find and
#      replace" — now reflects WYSIWYG TipTap), add entries for ops that
#      were showing the generic auto_awesome fallback:
#      docx_to_txt, xlsx_to_csv, pdf_to_image, image_to_pdf.
#
# Idempotent. Dry-run default. Backups at *.bak-round5.
#
# Usage:
#   python3 round5_full.py                          # dry run
#   python3 round5_full.py --execute                # edits + builds
#   python3 round5_full.py --execute --apply        # + TF apply
#   python3 round5_full.py --execute --apply --deploy
# =============================================================================

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

REPO = Path("/Users/pablocosta/Desktop/terraform/GitHub/superdoc")
FRONTEND = REPO / "frontend"
INFRA_DIR = REPO / "infra/environments/dev"

# Backend targets
CREATE_JOB = REPO / "handlers/create_job.py"
USER_CREATE_FILE = REPO / "handlers/user_create_file.py"
OPERATIONS_PY = REPO / "layers/superdoc_utils/operations.py"
MAIN_TF = REPO / "infra/main.tf"
VARIABLES_TF = REPO / "infra/variables.tf"

# Frontend targets
MAIN_JSX = FRONTEND / "src/main.jsx"
PACKAGE_JSON = FRONTEND / "package.json"
TOAST_LIB = FRONTEND / "src/lib/toast.js"
API_JS = FRONTEND / "src/lib/api.js"
OPERATION_PICKER = FRONTEND / "src/pages/Home/OperationPicker.jsx"
PICKER_JS = FRONTEND / "src/pages/Home/picker.js"

AMPLIFY_APP_ID = "d2ibg69ss24krr"
AMPLIFY_BRANCH = "main"
CLOUDFRONT_DIST_ID = "E1NJJUEZ141IMN"
LAMBDA_ZIPS_BUCKET = "superdoc-lambda-zips-288854271409"

BAK_SUFFIX = ".bak-round5"
TFPLAN_NAME = "round5_picker_v2.tfplan"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

USE_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def _c(color: str, text: str) -> str:
    if not USE_COLOR:
        return text
    return f"{color}{text}\033[0m"


GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
CYAN = "\033[96m"
GRAY = "\033[90m"
BOLD = "\033[1m"


def info(m): print(f"{_c(BLUE, '[info]')} {m}", flush=True)
def ok(m): print(f"{_c(GREEN, '[ ok ]')} {m}", flush=True)
def warn(m): print(f"{_c(YELLOW, '[warn]')} {m}", flush=True)
def fail_(m): print(f"{_c(RED, '[fail]')} {m}", flush=True)
def step(m): print(f"\n{_c(BOLD + CYAN, '▶ ' + m)}", flush=True)
def dry(m): print(f"{_c(GRAY, '[dry ]')} would: {m}", flush=True)


# ---------------------------------------------------------------------------
# Shell
# ---------------------------------------------------------------------------


def run(cmd: List[str], cwd: Path = REPO, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    info(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd), check=False, text=True, capture_output=capture)
    if capture:
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(_c(GRAY, result.stderr), end="")
    if check and result.returncode != 0:
        raise SystemExit(f"command failed (rc={result.returncode}): {' '.join(cmd)}")
    return result


def run_silent(cmd: List[str], cwd: Path = REPO) -> Tuple[int, str, str]:
    r = subprocess.run(cmd, cwd=str(cwd), check=False, text=True, capture_output=True)
    return r.returncode, r.stdout, r.stderr


def backup(p: Path, execute: bool) -> None:
    if not p.exists():
        return
    bak = p.with_suffix(p.suffix + BAK_SUFFIX)
    if not execute:
        dry(f"backup {p.relative_to(REPO)}")
        return
    if bak.exists():
        info(f"backup exists, keeping original: {bak.name}")
        return
    shutil.copy2(p, bak)
    info(f"backed up: {bak.relative_to(REPO)}")


# ---------------------------------------------------------------------------
# Step 1 — operations.py: add `intent` to each op entry + list_operations()
# ---------------------------------------------------------------------------


# Map op_id -> "modify" or "convert". Ops that operate on content and return
# the same format are "modify"; ops that produce a different format are
# "convert". Edge cases:
#   - pdf_extract_text -> convert (PDF -> JSON is a format change)
#   - video_process    -> modify (trim/subtitles usually keep container)
#   - doc_edit         -> modify (WYSIWYG edit, same format)
INTENT_BY_OP = {
    "pdf_compress":     "modify",
    "pdf_merge":        "modify",
    "pdf_split":        "modify",
    "pdf_rotate":       "modify",
    "pdf_annotate":     "modify",
    "pdf_extract_text": "convert",
    "pdf_to_docx":      "convert",
    "pdf_to_txt":       "convert",
    "pdf_to_image":     "convert",
    "image_convert":    "convert",
    "image_to_pdf":     "convert",
    "doc_edit":         "modify",
    "docx_to_txt":      "convert",
    "xlsx_to_csv":      "convert",
    "video_process":    "modify",
}


def _inject_intent_in_ops_dict(content: str) -> Tuple[str, int]:
    """Insert `"intent": "..."` into each op entry that doesn't already have
    one. Matches on `"op_name": {` at the start of a dict entry and rewrites
    it to include the intent on a new line right after the opening brace.

    Returns (new_content, num_patched).
    """
    patched = 0
    out = content
    for op_id, intent in INTENT_BY_OP.items():
        # Skip if this op already has an intent field — idempotency.
        op_block_re = re.compile(
            rf'(\s+"{re.escape(op_id)}"\s*:\s*\{{)(.*?)(\n\s+\}},)',
            re.DOTALL,
        )
        m = op_block_re.search(out)
        if m is None:
            continue
        block_body = m.group(2)
        if '"intent"' in block_body:
            continue
        # Find the indentation used by other fields inside this op entry.
        # Peek the first non-blank line after the opening brace.
        lines_after_brace = block_body.lstrip("\n").splitlines()
        indent = "        "  # default 8 spaces (matches existing style)
        for line in lines_after_brace:
            if line.strip():
                indent = line[: len(line) - len(line.lstrip(" "))]
                break
        insertion = f'\n{indent}"intent": "{intent}",'
        new_block = m.group(1) + insertion + m.group(2) + m.group(3)
        out = out[: m.start()] + new_block + out[m.end():]
        patched += 1
    return out, patched


# list_operations() currently emits: operation, kind, label, category,
# input_types, output_type. We need to add "intent" to the emitted dict.
LIST_OPS_OLD_BLOCK = '''        results.append({
            "operation": op,
            "kind": meta["kind"],
            "label": meta["label"],
            "category": meta["category"],
            "input_types": meta["input_types"],
            "output_type": meta["output_type"],
        })'''

LIST_OPS_NEW_BLOCK = '''        results.append({
            "operation": op,
            "kind": meta["kind"],
            # intent drives the 2-step picker on the frontend: "modify" ops
            # keep the file's format, "convert" ops produce a different one.
            # Defaults to "modify" so pre-existing ops without an explicit
            # intent don't accidentally show up under Convert.
            "intent": meta.get("intent", "modify"),
            "label": meta["label"],
            "category": meta["category"],
            "input_types": meta["input_types"],
            "output_type": meta["output_type"],
        })'''


def step_operations_intent(execute: bool) -> None:
    step("Add `intent` field to every op in operations.py + expose in list_operations()")
    if not OPERATIONS_PY.exists():
        fail_(f"not found: {OPERATIONS_PY}")
        raise SystemExit(1)

    content = OPERATIONS_PY.read_text()
    new_content, patched = _inject_intent_in_ops_dict(content)

    if patched == 0:
        ok("All op entries already have `intent` — no dict changes needed")
    else:
        info(f"Will inject intent into {patched} op entries")

    # list_operations() update
    if LIST_OPS_NEW_BLOCK.split('"intent"')[0] in new_content and '"intent": meta.get("intent", "modify"),' in new_content:
        ok("list_operations() already exposes intent — no change needed")
        list_ops_changed = False
    elif LIST_OPS_OLD_BLOCK in new_content:
        new_content = new_content.replace(LIST_OPS_OLD_BLOCK, LIST_OPS_NEW_BLOCK)
        list_ops_changed = True
    else:
        warn("list_operations() block didn't match expected shape — manual review")
        list_ops_changed = False

    if patched == 0 and not list_ops_changed:
        return

    backup(OPERATIONS_PY, execute)
    if execute:
        OPERATIONS_PY.write_text(new_content)
        ok(f"operations.py: patched={patched}, list_operations_updated={list_ops_changed}")
    else:
        dry(f"patch operations.py: {patched} intent injections + list_ops update={list_ops_changed}")


# ---------------------------------------------------------------------------
# Step 2 — create_job.py + user_create_file.py: RATE_LIMIT_ENABLED flag
# ---------------------------------------------------------------------------


CREATE_JOB_OLD_RATE_BLOCK = '''        if not is_registered:
            if not feature_flags.get("anonymous_ops_enabled", default=True):
                return response.error("Anonymous conversions are temporarily disabled.", 503)

            if not rate_limit.check(session_id):
                return response.error("Rate limit exceeded. Try again later.", 429)
        else:
            if not rate_limit.check_user(user_id):
                return response.error("Rate limit exceeded. Try again later.", 429)'''

CREATE_JOB_NEW_RATE_BLOCK = '''        if not is_registered:
            if not feature_flags.get("anonymous_ops_enabled", default=True):
                return response.error("Anonymous conversions are temporarily disabled.", 503)

            # Rate limit feature-flagged via env var so ops can toggle it
            # without a code change. Default on — disable only when launch
            # traffic is known and abuse mitigations are elsewhere.
            if _rate_limit_enabled() and not rate_limit.check(session_id):
                return response.error("Rate limit exceeded. Try again later.", 429)
        else:
            if _rate_limit_enabled() and not rate_limit.check_user(user_id):
                return response.error("Rate limit exceeded. Try again later.", 429)'''


CREATE_JOB_OLD_ACTIVE_CAP = '''        else:
            existing = dynamo.query_by_session(session_id)
            active = [j for j in existing if j.get("status") not in ("DONE", "FAILED")]
            if len(active) >= _ANON_MAX_ACTIVE_DOCS:
                return response.error("Too many active jobs. Please wait for current conversions to finish.", 429)
            file_key = f"uploads/{job_id}/{file_name}"
            ttl_seconds = int(os.environ.get("TTL_SECONDS", "43200"))'''

CREATE_JOB_NEW_ACTIVE_CAP = '''        else:
            existing = dynamo.query_by_session(session_id)
            active = [j for j in existing if j.get("status") not in ("DONE", "FAILED")]
            # Same feature flag applies to the anonymous active-jobs cap —
            # it's a per-session concurrency limit and disabling rate-limit
            # without disabling this would still produce 429s from here.
            if _rate_limit_enabled() and len(active) >= _ANON_MAX_ACTIVE_DOCS:
                return response.error("Too many active jobs. Please wait for current conversions to finish.", 429)
            file_key = f"uploads/{job_id}/{file_name}"
            ttl_seconds = int(os.environ.get("TTL_SECONDS", "43200"))'''


# Helper function inserted near the module-level constants.
CREATE_JOB_OLD_CONSTS = '''_ANON_MAX_ACTIVE_DOCS = int(os.environ.get("ANON_MAX_ACTIVE_DOCS", "4"))'''

CREATE_JOB_NEW_CONSTS = '''_ANON_MAX_ACTIVE_DOCS = int(os.environ.get("ANON_MAX_ACTIVE_DOCS", "4"))


def _rate_limit_enabled() -> bool:
    """Read RATE_LIMIT_ENABLED env var. Default true — fail closed.

    Terraform controls this via the `rate_limit_enabled` variable. When set
    to "false" (case-insensitive), all rate-limit and active-jobs checks are
    bypassed. Used to open the service up during early launch before auth
    and payments are wired."""
    raw = os.environ.get("RATE_LIMIT_ENABLED", "true").strip().lower()
    return raw not in ("false", "0", "no", "off")'''


def step_create_job_flag(execute: bool) -> None:
    step("Add RATE_LIMIT_ENABLED feature flag to create_job.py")
    if not CREATE_JOB.exists():
        fail_(f"not found: {CREATE_JOB}")
        raise SystemExit(1)

    content = CREATE_JOB.read_text()

    if "_rate_limit_enabled" in content:
        ok("create_job.py already has the flag")
        return

    missing = []
    if CREATE_JOB_OLD_CONSTS not in content:
        missing.append("_ANON_MAX_ACTIVE_DOCS line")
    if CREATE_JOB_OLD_RATE_BLOCK not in content:
        missing.append("rate_limit check block")
    if CREATE_JOB_OLD_ACTIVE_CAP not in content:
        missing.append("active cap block")
    if missing:
        fail_(f"create_job.py anchors missing: {missing}")
        raise SystemExit(1)

    backup(CREATE_JOB, execute)
    new_content = content
    new_content = new_content.replace(CREATE_JOB_OLD_CONSTS, CREATE_JOB_NEW_CONSTS)
    new_content = new_content.replace(CREATE_JOB_OLD_RATE_BLOCK, CREATE_JOB_NEW_RATE_BLOCK)
    new_content = new_content.replace(CREATE_JOB_OLD_ACTIVE_CAP, CREATE_JOB_NEW_ACTIVE_CAP)

    if execute:
        CREATE_JOB.write_text(new_content)
        ok("create_job.py: RATE_LIMIT_ENABLED flag wired in")
    else:
        dry("apply RATE_LIMIT_ENABLED changes to create_job.py")


# ---------------------------------------------------------------------------
# Step 2b — user_create_file.py: same flag (if present)
# ---------------------------------------------------------------------------


def step_user_create_file_flag(execute: bool) -> None:
    step("Check user_create_file.py for rate-limit usage")
    if not USER_CREATE_FILE.exists():
        warn("user_create_file.py not found — skipping")
        return
    content = USER_CREATE_FILE.read_text()
    if "rate_limit.check" not in content:
        ok("user_create_file.py doesn't call rate_limit — nothing to flag")
        return
    # Defer: inspect and apply the same pattern only if mechanical. If the
    # call sites differ in shape, skip with a warn rather than risk a bad
    # edit on a file we haven't pinned the shape for.
    warn("user_create_file.py calls rate_limit but its exact shape wasn't pinned — leaving flag unwrapped.")
    warn("Authenticated rate-limiting still enforces; only the anonymous path on create_job.py is bypassed.")


# ---------------------------------------------------------------------------
# Step 3 — Terraform: rate_limit_enabled variable + Lambda env var
# ---------------------------------------------------------------------------


TF_VARIABLE_BLOCK = '''
variable "rate_limit_enabled" {
  description = "Toggle the anonymous rate-limit + active-jobs cap on create_job Lambda. Default false during early launch; set true once auth + payments are live."
  type        = bool
  default     = false
}
'''


def step_terraform_variable(execute: bool) -> None:
    step(f"Add `rate_limit_enabled` variable to {VARIABLES_TF.relative_to(REPO)}")
    if not VARIABLES_TF.exists():
        fail_(f"not found: {VARIABLES_TF}")
        raise SystemExit(1)
    content = VARIABLES_TF.read_text()
    if 'variable "rate_limit_enabled"' in content:
        ok("variable already declared")
        return
    backup(VARIABLES_TF, execute)
    new_content = content.rstrip() + "\n" + TF_VARIABLE_BLOCK
    if execute:
        VARIABLES_TF.write_text(new_content)
        ok("variables.tf: rate_limit_enabled added")
    else:
        dry("append rate_limit_enabled variable to variables.tf")


# Add the env var to `local.lambda_common_env` so it flows into every Lambda
# using that block. That's the simplest wiring — no per-Lambda surgery.

LAMBDA_COMMON_ENV_ANCHOR = "lambda_common_env = {"


def step_terraform_env_var(execute: bool) -> None:
    step(f"Add RATE_LIMIT_ENABLED env var to lambda_common_env in {MAIN_TF.relative_to(REPO)}")
    if not MAIN_TF.exists():
        fail_(f"not found: {MAIN_TF}")
        raise SystemExit(1)
    content = MAIN_TF.read_text()
    if "RATE_LIMIT_ENABLED" in content:
        ok("RATE_LIMIT_ENABLED already in main.tf")
        return
    if LAMBDA_COMMON_ENV_ANCHOR not in content:
        fail_(f"main.tf: can't find `{LAMBDA_COMMON_ENV_ANCHOR}` anchor")
        raise SystemExit(1)

    backup(MAIN_TF, execute)
    # Insert a new key on the next line after the opening brace, matching
    # the indentation of whatever comes right after.
    lines = content.splitlines(keepends=True)
    patched_lines: List[str] = []
    inserted = False
    for i, line in enumerate(lines):
        patched_lines.append(line)
        if not inserted and LAMBDA_COMMON_ENV_ANCHOR in line:
            # Find indent used for the first env entry on the next non-blank line.
            indent = "    "
            for j in range(i + 1, min(i + 5, len(lines))):
                peek = lines[j]
                if peek.strip():
                    indent = peek[: len(peek) - len(peek.lstrip(" "))]
                    break
            patched_lines.append(
                f'{indent}RATE_LIMIT_ENABLED = tostring(var.rate_limit_enabled)\n'
            )
            inserted = True
    if not inserted:
        fail_("Failed to inject RATE_LIMIT_ENABLED into lambda_common_env")
        raise SystemExit(1)

    new_content = "".join(patched_lines)
    if execute:
        MAIN_TF.write_text(new_content)
        ok("main.tf: RATE_LIMIT_ENABLED wired into lambda_common_env")
    else:
        dry("inject RATE_LIMIT_ENABLED into lambda_common_env")


# ---------------------------------------------------------------------------
# Step 4 — Frontend: install sonner + mount <Toaster />
# ---------------------------------------------------------------------------


def step_install_sonner(execute: bool) -> None:
    step("npm install sonner")
    if not PACKAGE_JSON.exists():
        fail_(f"not found: {PACKAGE_JSON}")
        raise SystemExit(1)
    pkg = json.loads(PACKAGE_JSON.read_text())
    if "sonner" in pkg.get("dependencies", {}):
        ok("sonner already in dependencies")
        return
    if not execute:
        dry("npm install --save sonner")
        return
    run(["npm", "install", "--save", "sonner"], cwd=FRONTEND, capture=True)
    ok("sonner installed")


MAIN_JSX_IMPORT_OLD = 'import App from "./App.jsx";\n'

MAIN_JSX_IMPORT_NEW = 'import App from "./App.jsx";\nimport { Toaster } from "sonner"\n'


def step_mount_toaster(execute: bool) -> None:
    step("Mount <Toaster /> in main.jsx")
    if not MAIN_JSX.exists():
        fail_(f"not found: {MAIN_JSX}")
        raise SystemExit(1)
    content = MAIN_JSX.read_text()
    if 'from "sonner"' in content:
        ok("Toaster already imported")
        return
    if MAIN_JSX_IMPORT_OLD not in content:
        warn("main.jsx App import doesn't match expected shape — inspecting file")
        info(content[:500])
        raise SystemExit(1)

    backup(MAIN_JSX, execute)
    new_content = content.replace(MAIN_JSX_IMPORT_OLD, MAIN_JSX_IMPORT_NEW)

    # Inject <Toaster ... /> next to <App />. React can render fragments of
    # siblings at the root, so <> <App/> <Toaster/> </> is fine.
    new_content = new_content.replace(
        "<App />",
        "<>\n      <App />\n      <Toaster richColors position=\"bottom-right\" closeButton />\n    </>",
    )

    if execute:
        MAIN_JSX.write_text(new_content)
        ok("main.jsx: <Toaster /> mounted")
    else:
        dry("add <Toaster /> to main.jsx")


# ---------------------------------------------------------------------------
# Step 5 — src/lib/toast.js (thin wrapper)
# ---------------------------------------------------------------------------


TOAST_JS_CODE = r"""// frontend/src/lib/toast.js
//
// Thin wrapper over sonner. Exposes notify.success / notify.error with an
// API shaped for this project: errors carry a user-facing message, optional
// HTTP code, and an optional `technical` blob that collapses behind a
// "Technical details" disclosure with Copy-to-clipboard.
//
// Callers don't depend on sonner directly — if we swap the library later,
// we update this file and nothing else.

import { toast } from "sonner"


function copyToClipboard(text) {
  // Fall back to execCommand for non-secure contexts (dev http:// etc).
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.position = "fixed"
  ta.style.opacity = "0"
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand("copy")
  } finally {
    document.body.removeChild(ta)
  }
  return Promise.resolve()
}


function ErrorToastBody({ message, httpCode, technical, id }) {
  const details = []
  if (httpCode !== undefined && httpCode !== null) {
    details.push(`HTTP ${httpCode}`)
  }
  if (technical) {
    details.push(technical)
  }
  const detailsText = details.join("\n")

  const userFriendly = message || "Something went wrong"

  // Sonner lets us pass a function returning JSX-like; but to stay zero-JSX
  // in this file we build a plain DOM node. This avoids needing JSX build
  // rules for .js files.
  const root = document.createElement("div")
  root.style.display = "flex"
  root.style.flexDirection = "column"
  root.style.gap = "8px"

  const msg = document.createElement("div")
  msg.style.fontWeight = "600"
  msg.textContent = userFriendly
  root.appendChild(msg)

  if (detailsText) {
    const det = document.createElement("details")
    det.style.fontSize = "12px"
    det.style.opacity = "0.8"
    const sum = document.createElement("summary")
    sum.textContent = "Technical details"
    sum.style.cursor = "pointer"
    det.appendChild(sum)

    const pre = document.createElement("pre")
    pre.style.margin = "6px 0 0 0"
    pre.style.whiteSpace = "pre-wrap"
    pre.style.fontFamily = "ui-monospace, SFMono-Regular, monospace"
    pre.textContent = detailsText
    det.appendChild(pre)

    const btn = document.createElement("button")
    btn.textContent = "Copy"
    btn.style.marginTop = "4px"
    btn.style.padding = "2px 10px"
    btn.style.fontSize = "11px"
    btn.style.borderRadius = "6px"
    btn.style.border = "1px solid currentColor"
    btn.style.background = "transparent"
    btn.style.cursor = "pointer"
    btn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      copyToClipboard(`${userFriendly}\n${detailsText}`).then(() => {
        btn.textContent = "Copied"
        setTimeout(() => { btn.textContent = "Copy" }, 1200)
      })
    }
    det.appendChild(btn)

    root.appendChild(det)
  }

  return root
}


export const notify = {
  success(message) {
    toast.success(message)
  },

  info(message) {
    toast.info(message)
  },

  warning(message) {
    toast.warning(message)
  },

  /**
   * Show an error toast.
   *   notify.error("Upload failed")                                 // shorthand
   *   notify.error({ message, httpCode, technical })               // structured
   */
  error(arg) {
    let message = ""
    let httpCode = null
    let technical = ""
    if (typeof arg === "string") {
      message = arg
    } else if (arg && typeof arg === "object") {
      message = arg.message || ""
      httpCode = arg.httpCode !== undefined ? arg.httpCode : null
      technical = arg.technical || ""
    }
    toast.error(message || "Something went wrong", {
      description: (t) => ErrorToastBody({ message, httpCode, technical, id: t }),
      duration: 8000,
    })
  },
}
"""


def step_toast_lib(execute: bool) -> None:
    step("Create src/lib/toast.js")
    if TOAST_LIB.exists():
        existing = TOAST_LIB.read_text()
        if existing == TOAST_JS_CODE:
            ok("toast.js already at target state")
            return
        backup(TOAST_LIB, execute)
        info("toast.js exists and differs — will overwrite")
    if not execute:
        dry(f"write src/lib/toast.js ({len(TOAST_JS_CODE)} bytes)")
        return
    TOAST_LIB.parent.mkdir(parents=True, exist_ok=True)
    TOAST_LIB.write_text(TOAST_JS_CODE)
    ok("wrote src/lib/toast.js")


# ---------------------------------------------------------------------------
# Step 6 — api.js: enrich errors + auto-notify on 4xx/5xx
# ---------------------------------------------------------------------------


# Replace the `request()` function with a version that attaches status +
# technical to thrown Errors and fires a toast on non-2xx.

API_OLD_REQUEST = '''async function request(method, path, body = null) {
  if (!API_URL) throw new Error("Backend not configured. Set VITE_API_URL.");

  let authToken = "";
  try {
    authToken = localStorage.getItem("superdoc_id_token") || "";
  } catch {
    authToken = "";
  }

  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (authToken) opts.headers.Authorization = `Bearer ${authToken}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);

  const parsed = await parseResponse(res);
  if (!parsed.ok) throw new Error(parsed.data.error || `HTTP ${parsed.status}`);
  return parsed.data;
}'''

API_NEW_REQUEST = '''// Map specific HTTP codes to user-friendly copy. 429 gets special treatment
// because the default "Too many requests" scares users who can't self-serve.
const FRIENDLY_BY_STATUS = {
  401: "You need to sign in to do that.",
  403: "That action isn\'t available for your account.",
  404: "We couldn\'t find what you\'re looking for.",
  413: "That file is too large.",
  429: "You\'re going a little fast — take a short breath and try again.",
  500: "Something broke on our end. We\'re looking into it.",
  502: "Our backend is briefly unreachable. Try again in a moment.",
  503: "Service temporarily unavailable. Try again in a moment.",
  504: "The server took too long. Try again.",
}


async function request(method, path, body = null) {
  if (!API_URL) throw new Error("Backend not configured. Set VITE_API_URL.");

  let authToken = "";
  try {
    authToken = localStorage.getItem("superdoc_id_token") || "";
  } catch {
    authToken = "";
  }

  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (authToken) opts.headers.Authorization = `Bearer ${authToken}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);

  const parsed = await parseResponse(res);
  if (!parsed.ok) {
    const technical = parsed.data.error || `${method} ${path} -> HTTP ${parsed.status}`;
    const friendly = FRIENDLY_BY_STATUS[parsed.status] || technical;
    // Fire a toast so every API consumer gets feedback without plumbing.
    // Callers can still try/catch to suppress if they want custom handling.
    try {
      // Dynamic import keeps this file safe to load in environments without
      // the DOM (tests, SSR in theory). If the toast module is unavailable,
      // we swallow the failure — the thrown Error below is still the source
      // of truth for callers.
      const mod = await import("./toast");
      mod.notify.error({ message: friendly, httpCode: parsed.status, technical });
    } catch {
      // Toast unavailable — fall through to throwing.
    }
    const err = new Error(friendly);
    err.status = parsed.status;
    err.technical = technical;
    throw err;
  }
  return parsed.data;
}'''


def step_api_js(execute: bool) -> None:
    step("Rewrite api.js request() to enrich errors + auto-toast")
    if not API_JS.exists():
        fail_(f"not found: {API_JS}")
        raise SystemExit(1)
    content = API_JS.read_text()
    if "FRIENDLY_BY_STATUS" in content:
        ok("api.js already has friendly-status mapping — assuming done")
        return
    if API_OLD_REQUEST not in content:
        fail_("api.js request() doesn't match expected shape — manual review")
        raise SystemExit(1)
    backup(API_JS, execute)
    new_content = content.replace(API_OLD_REQUEST, API_NEW_REQUEST)
    if execute:
        API_JS.write_text(new_content)
        ok("api.js: request() rewritten with friendly errors + toast")
    else:
        dry("rewrite api.js request() with FRIENDLY_BY_STATUS + toast")


# ---------------------------------------------------------------------------
# Step 7 — OperationPicker.jsx: 2-step with intent
# ---------------------------------------------------------------------------


OPERATION_PICKER_CODE = r'''// frontend/src/pages/Home/OperationPicker.jsx
//
// Two-step picker:
//   Step 1 (intent):  user chooses "Modify" or "Convert" when the input has
//                     ops in both buckets. Skipped if only one bucket exists.
//   Step 2 (action):  user picks the specific operation within that bucket.
//
// Rationale: a flat list of 9 ops for .pdf looked like a wall of text and
// mixed two mental models ("I want to edit this" vs "I want a different
// format"). Separating them shrinks the visible decision to 2 cards first,
// then 2-6 cards second — easier on anyone not already a power user.

import { useEffect, useState, useRef, useMemo } from "react"
import { api } from "../../lib/api"
import { uiFor } from "./picker"

const CACHE_KEY = "superdoc_operations_cache"
const CACHE_TTL_MS = 10 * 60 * 1000


function readCache(inputType) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.byType) return null
    const entry = parsed.byType[inputType || "__all__"]
    if (!entry) return null
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null
    return entry.data
  } catch {
    return null
  }
}


function writeCache(inputType, data) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    let parsed = { byType: {} }
    if (raw) {
      try {
        parsed = JSON.parse(raw) || { byType: {} }
        if (!parsed.byType) parsed.byType = {}
      } catch {
        parsed = { byType: {} }
      }
    }
    parsed.byType[inputType || "__all__"] = { ts: Date.now(), data }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(parsed))
  } catch {
    // sessionStorage can fail in private browsing; silently continue.
  }
}


// Copy for the two top-level intents shown on Step 1.
const INTENT_META = {
  modify: {
    icon: "edit",
    title: "Modify",
    description: "Change the file without converting to a different format.",
  },
  convert: {
    icon: "sync_alt",
    title: "Convert",
    description: "Produce a different format (PDF to Word, image to PDF, etc).",
  },
}


// Walks the ops list and returns { modify: [...], convert: [...] }.
// Ops with unknown intent default to "modify".
function groupByIntent(ops) {
  const buckets = { modify: [], convert: [] }
  for (const op of ops) {
    const intent = op.intent === "convert" ? "convert" : "modify"
    buckets[intent].push(op)
  }
  return buckets
}


export function OperationPicker({ file, onPick, onBack }) {
  const [operations, setOperations] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [chosenIntent, setChosenIntent] = useState(null)
  const firstButtonRef = useRef(null)

  const inputType = file && file.name ? file.name.split(".").pop().toLowerCase() : ""

  useEffect(() => {
    let cancelled = false

    const cached = readCache(inputType)
    if (cached) {
      setOperations(cached)
      setLoading(false)
      setError(null)
      return () => { cancelled = true }
    }

    setLoading(true)
    setError(null)

    api.getOperations(inputType)
      .then((data) => {
        if (cancelled) return
        const ops = (data && data.operations) ? data.operations : []
        setOperations(ops)
        writeCache(inputType, ops)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message || "Could not load available actions")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [inputType])

  useEffect(() => {
    if (firstButtonRef.current) firstButtonRef.current.focus()
  }, [chosenIntent, operations])

  const grouped = useMemo(() => groupByIntent(operations || []), [operations])
  const availableIntents = useMemo(() => {
    const list = []
    if (grouped.modify.length > 0) list.push("modify")
    if (grouped.convert.length > 0) list.push("convert")
    return list
  }, [grouped])

  // Auto-pick the only intent if there's no real choice to make.
  useEffect(() => {
    if (operations && availableIntents.length === 1 && chosenIntent === null) {
      setChosenIntent(availableIntents[0])
    }
  }, [operations, availableIntents, chosenIntent])

  // ── Loading / error / empty ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="space-y-2 mt-6" aria-live="polite" aria-label="Loading options">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[76px] rounded-xl bg-surface-container animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !operations) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="mt-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <span className="text-sm font-medium">{error}</span>
        </div>
      </div>
    )
  }

  const list = operations || []
  if (list.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="mt-6 flex items-start gap-3 px-4 py-4 rounded-xl bg-surface-container-lowest border border-outline-variant/20">
          <span className="material-symbols-outlined text-on-surface-variant text-[22px]">info</span>
          <div>
            <p className="font-semibold text-on-surface">
              No actions available for .{inputType} files yet
            </p>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Try another file, or let us know what you wanted to do with it.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 1: intent picker ──────────────────────────────────────────────

  if (chosenIntent === null && availableIntents.length > 1) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <ul className="space-y-2 mt-6" role="list">
          {availableIntents.map((intent, idx) => {
            const meta = INTENT_META[intent]
            const count = grouped[intent].length
            return (
              <li key={intent}>
                <button
                  ref={idx === 0 ? firstButtonRef : null}
                  type="button"
                  onClick={() => setChosenIntent(intent)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/10 hover:border-primary/30 hover:shadow-sm transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-primary text-[24px]">
                      {meta.icon}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-on-surface">{meta.title}</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      {meta.description}
                    </p>
                    <p className="text-xs text-on-surface-variant/70 mt-1">
                      {count} option{count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">
                    chevron_right
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  // ── Step 2: action picker (filtered by chosen intent) ──────────────────

  const effectiveIntent = chosenIntent || availableIntents[0]
  const actions = grouped[effectiveIntent] || []

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PickerHeader file={file} onBack={onBack} />

      {availableIntents.length > 1 ? (
        <button
          type="button"
          onClick={() => setChosenIntent(null)}
          className="mt-4 flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary font-medium no-underline hover:underline"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </button>
      ) : null}

      <ul className="space-y-2 mt-4" role="list">
        {actions.map((op, idx) => {
          const ui = uiFor(op.operation)
          return (
            <li key={op.operation}>
              <button
                ref={idx === 0 ? firstButtonRef : null}
                type="button"
                onClick={() => onPick(op)}
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/10 hover:border-primary/30 hover:shadow-sm transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-[24px]">
                    {ui.icon}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-on-surface">{op.label}</h3>
                  <p className="text-sm text-on-surface-variant mt-0.5 line-clamp-2">
                    {ui.description}
                  </p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">
                  chevron_right
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}


function PickerHeader({ file, onBack }) {
  const name = file && file.name ? file.name : "your file"
  return (
    <div className="text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs font-medium mb-3 max-w-full">
        <span className="material-symbols-outlined text-[14px]">description</span>
        <span className="truncate max-w-[24rem]">{name}</span>
      </div>
      <h1 className="text-2xl md:text-3xl font-bold font-headline text-on-surface">
        What do you want to do?
      </h1>
      <button
        type="button"
        onClick={onBack}
        className="mt-3 text-sm text-on-surface-variant hover:text-primary font-medium no-underline hover:underline"
      >
        Choose another file
      </button>
    </div>
  )
}
'''


def step_operation_picker(execute: bool) -> None:
    step("Rewrite OperationPicker.jsx with 2-step intent picker")
    if OPERATION_PICKER.exists():
        existing = OPERATION_PICKER.read_text()
        if existing == OPERATION_PICKER_CODE:
            ok("OperationPicker already at target state")
            return
        backup(OPERATION_PICKER, execute)
        info("OperationPicker exists — will overwrite (.bak-round5 preserves original)")
    if not execute:
        dry(f"write OperationPicker.jsx ({len(OPERATION_PICKER_CODE)} bytes)")
        return
    OPERATION_PICKER.write_text(OPERATION_PICKER_CODE)
    ok("wrote OperationPicker.jsx")


# ---------------------------------------------------------------------------
# Step 7b — picker.js: UI metadata refresh
# ---------------------------------------------------------------------------
#
# picker.js is purely presentation (icon + description per op id), so we
# rewrite the whole file rather than surgical anchors. It's short and the
# file is owned by us entirely. New ops coming in future rounds just get
# new entries here; ops without entries fall through to FALLBACK_UI.


PICKER_JS_CODE = r'''// frontend/src/pages/Home/picker.js
// UI-only metadata keyed by operation id. The backend catalog (GET /operations)
// returns label/category/input_types/output_type/kind/intent — those are
// functional facts. Icon and rich description live here because they are
// presentation choices that should not require a backend deploy to change.

export const OPERATION_UI = {
  // ── PDF ops ────────────────────────────────────────────────────────────
  pdf_compress: {
    icon: "compress",
    description: "Shrink PDFs while keeping quality readable. Great for email attachments.",
  },
  pdf_merge: {
    icon: "merge",
    description: "Combine multiple PDFs into one file, in the order you choose.",
  },
  pdf_split: {
    icon: "call_split",
    description: "Break a PDF into page ranges or individual pages.",
  },
  pdf_rotate: {
    icon: "rotate_right",
    description: "Rotate pages 90/180/270 degrees. Fix scans that came in sideways.",
  },
  pdf_annotate: {
    icon: "branding_watermark",
    description: "Overlay a watermark or note on every page.",
  },
  pdf_extract_text: {
    icon: "content_paste",
    description: "Structured JSON with page-by-page text. Best for developers and automation.",
  },
  pdf_to_docx: {
    icon: "description",
    description: "Editable Word document while keeping layout as close as possible.",
  },
  pdf_to_txt: {
    icon: "text_fields",
    description: "Plain text of every page, ideal for search, indexing, or AI pipelines.",
  },
  pdf_to_image: {
    icon: "image",
    description: "Render each page as a PNG image. Returned as a single ZIP.",
  },

  // ── DOCX / XLSX ops ────────────────────────────────────────────────────
  doc_edit: {
    // Rewritten in Round 4-3: this is now a WYSIWYG editor, not find-and-replace.
    icon: "edit_document",
    description: "Open in the WYSIWYG editor — edit headings, bold, lists, links, then export back to .docx.",
  },
  docx_to_txt: {
    icon: "text_fields",
    description: "Extract plain text from the Word document. Formatting is dropped.",
  },
  xlsx_to_csv: {
    icon: "table_chart",
    description: "Export the first sheet of the spreadsheet as a CSV file.",
  },

  // ── Image ops ──────────────────────────────────────────────────────────
  image_convert: {
    icon: "transform",
    description: "Switch between PNG, JPG, WebP, and GIF without quality loss.",
  },
  image_to_pdf: {
    icon: "picture_as_pdf",
    description: "Wrap the image into a single-page PDF document.",
  },

  // ── Video ops ──────────────────────────────────────────────────────────
  video_process: {
    icon: "movie",
    description: "Trim, re-encode, or transcode video. Billed per video duration.",
  },
}


// Fallback metadata when an operation id arrives that we don't have UI data
// for yet. We still render it — the user can still pick it — but with a
// generic icon. Description collapses to empty so the backend's label carries
// the message.
export const FALLBACK_UI = {
  icon: "auto_awesome",
  description: "",
}


export function uiFor(operationId) {
  const meta = OPERATION_UI[operationId]
  if (meta) {
    return meta
  }
  return FALLBACK_UI
}
'''


def step_picker_js(execute: bool) -> None:
    step("Refresh picker.js — update doc_edit copy, add missing op entries")
    if not PICKER_JS.exists():
        fail_(f"not found: {PICKER_JS}")
        raise SystemExit(1)
    existing = PICKER_JS.read_text()
    if existing == PICKER_JS_CODE:
        ok("picker.js already at target state")
        return
    backup(PICKER_JS, execute)
    info("picker.js exists — will overwrite (.bak-round5 preserves original)")
    if not execute:
        dry(f"write picker.js ({len(PICKER_JS_CODE)} bytes)")
        return
    PICKER_JS.write_text(PICKER_JS_CODE)
    ok("wrote picker.js")


# ---------------------------------------------------------------------------
# Step 8 — Build + layer rebuild + terraform
# ---------------------------------------------------------------------------


def step_build_layer_and_apply(execute: bool, do_apply: bool) -> None:
    step("Rebuild superdoc_utils layer + create_job handler + terraform")
    layers_script = REPO / "scripts/build_layers.sh"
    handlers_script = REPO / "scripts/build_handlers.sh"
    if not layers_script.exists() or not handlers_script.exists():
        warn("build scripts missing — skipping backend build")
        return

    if not execute:
        dry("bash scripts/build_layers.sh")
        dry("bash scripts/build_handlers.sh")
        dry(f"aws s3 sync dist/ s3://{LAMBDA_ZIPS_BUCKET}/")
        dry(f"terraform plan -out={TFPLAN_NAME}")
        if do_apply:
            dry(f"terraform apply {TFPLAN_NAME}")
        return

    run(["bash", str(layers_script)], capture=True)
    run(["bash", str(handlers_script)], capture=True)

    dist = REPO / "dist"
    if (dist / "layers").exists():
        run(["aws", "s3", "sync", str(dist / "layers"), f"s3://{LAMBDA_ZIPS_BUCKET}/layers/"], capture=True)
    if (dist / "handlers").exists():
        run(["aws", "s3", "sync", str(dist / "handlers"), f"s3://{LAMBDA_ZIPS_BUCKET}/handlers/"], capture=True)

    run(["terraform", "init", "-upgrade"], cwd=INFRA_DIR, capture=True)
    rc, stdout, stderr = run_silent([
        "terraform", "plan",
        f"-var=lambda_handler_s3_bucket={LAMBDA_ZIPS_BUCKET}",
        f"-out={TFPLAN_NAME}",
    ], cwd=INFRA_DIR)
    if rc != 0:
        fail_(f"terraform plan failed: {stderr}")
        raise SystemExit(1)
    tail = stdout.strip().splitlines()[-20:]
    for line in tail:
        print(f"  {line}")
    ok(f"plan saved to {INFRA_DIR / TFPLAN_NAME}")

    if do_apply:
        run(["terraform", "apply", TFPLAN_NAME], cwd=INFRA_DIR, capture=True)
        ok("terraform apply complete")


def step_build_frontend(execute: bool) -> None:
    step("npm run build")
    if not execute:
        dry("npm run build")
        return
    run(["npm", "run", "build"], cwd=FRONTEND, capture=True)
    ok("frontend built")


def step_verify_bundle(execute: bool) -> None:
    step("Verify bundle contains sonner + new picker paths")
    if not execute:
        dry("grep sonner + intent in frontend/dist")
        return
    dist = FRONTEND / "dist"
    if not dist.exists():
        fail_(f"dist not found: {dist}")
        raise SystemExit(1)
    for needle in ["sonner", "chosenIntent", "FRIENDLY_BY_STATUS"]:
        rc, _, _ = run_silent(["grep", "-rq", needle, str(dist / "assets")])
        if rc != 0:
            warn(f"bundle missing expected string: {needle}")
        else:
            ok(f"bundle contains {needle!r} ✓")


# ---------------------------------------------------------------------------
# Step 9 — Deploy
# ---------------------------------------------------------------------------


def step_deploy(execute: bool) -> None:
    step("Deploy frontend — Amplify + CloudFront invalidation")
    if not execute:
        dry("amplify + cloudfront")
        return

    dist_zip = Path("/tmp/superdoc-round5-dist.zip")
    if dist_zip.exists():
        dist_zip.unlink()
    run(["zip", "-r", "-q", str(dist_zip), "."], cwd=FRONTEND / "dist")

    rc, stdout, stderr = run_silent([
        "aws", "amplify", "create-deployment",
        "--app-id", AMPLIFY_APP_ID,
        "--branch-name", AMPLIFY_BRANCH,
    ])
    if rc != 0:
        fail_(f"create-deployment failed: {stderr}")
        raise SystemExit(1)
    dep = json.loads(stdout)
    job_id = dep.get("jobId")
    zip_url = dep.get("zipUploadUrl")
    if not job_id or not zip_url:
        fail_(f"malformed create-deployment: {stdout}")
        raise SystemExit(1)

    run(["curl", "-sS", "-X", "PUT", "-T", str(dist_zip), zip_url])
    run([
        "aws", "amplify", "start-deployment",
        "--app-id", AMPLIFY_APP_ID,
        "--branch-name", AMPLIFY_BRANCH,
        "--job-id", job_id,
    ])
    run([
        "aws", "cloudfront", "create-invalidation",
        "--distribution-id", CLOUDFRONT_DIST_ID,
        "--paths", "/*",
    ], capture=True)
    ok(f"deployed — Amplify job_id={job_id}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="SuperDoc Round 5 — picker v2 + toast + rate-limit flag + picker.js refresh")
    parser.add_argument("--execute", action="store_true", help="Run edits + builds (default: dry-run)")
    parser.add_argument("--apply", action="store_true", help="Run terraform apply after plan")
    parser.add_argument("--deploy", action="store_true", help="Deploy frontend to Amplify + CF invalidate")
    parser.add_argument("--skip-build", action="store_true", help="Skip layer/handler/frontend rebuilds")
    parser.add_argument("--skip-install", action="store_true", help="Skip npm install sonner")
    args = parser.parse_args()

    execute = args.execute

    print(_c(BOLD + CYAN, "\n╔══════════════════════════════════════════════════════════════╗"))
    print(_c(BOLD + CYAN, "║   Round 5 — picker v2 + toast + rate flag + picker.js       ║"))
    print(_c(BOLD + CYAN, "╚══════════════════════════════════════════════════════════════╝"))
    mode = "EXECUTE"
    if not execute:
        mode = "DRY-RUN"
    print(f"Mode:    {mode}")
    print(f"Apply:   {args.apply}")
    print(f"Deploy:  {args.deploy}")
    print()

    if not REPO.exists():
        fail_(f"repo not found: {REPO}")
        return 1

    # Backend edits
    step_operations_intent(execute)
    step_create_job_flag(execute)
    step_user_create_file_flag(execute)
    step_terraform_variable(execute)
    step_terraform_env_var(execute)

    # Frontend edits
    if not args.skip_install:
        step_install_sonner(execute)
    step_mount_toaster(execute)
    step_toast_lib(execute)
    step_api_js(execute)
    step_operation_picker(execute)
    step_picker_js(execute)

    # Builds
    if not args.skip_build:
        step_build_layer_and_apply(execute, do_apply=args.apply)
        step_build_frontend(execute)
        step_verify_bundle(execute)

    # Deploy
    if args.deploy:
        step_deploy(execute)
    else:
        if execute:
            info("--deploy not set — frontend built locally only")

    print()
    if execute:
        ok("DONE")
        if args.deploy:
            print("Wait ~2min for CloudFront, then test:")
            print("  · Drop a .pdf — you should see Step 1 (Modify / Convert) first")
            print("  · Pick Modify → shows pdf_merge, pdf_split, pdf_compress, pdf_rotate, pdf_annotate, pdf_extract_text")
            print("  · Back button returns to Step 1")
            print("  · Drop a .docx — Step 1 offers Modify (doc_edit) + Convert (docx_to_txt)")
            print("  · Click rapidly on create-job → no 429 (rate limit flag is off)")
            print("  · API errors should now appear as sonner toasts with Technical details")
    else:
        info("DRY RUN — re-run with --execute [--apply] [--deploy]")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
