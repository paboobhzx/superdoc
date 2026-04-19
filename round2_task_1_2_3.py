#!/usr/bin/env python3
# =============================================================================
# SuperDoc Round 2 - Tasks 1, 2, 3
# =============================================================================
#
# Task 1: Refactor operations.py into a structured catalog with rich metadata.
# Task 2: Add GET /operations endpoint (handler + Lambda + API Gateway route).
# Task 3: Add pdf_to_txt operation (handler + Lambda + dispatcher wiring).
#
# This is a one-shot deployment script. It is intentionally procedural and
# linear - no Strategy/Command/Chain abstractions. Each step is a function;
# main() calls them in order. File edits are idempotent (sentinel checks),
# and every edited file gets a .bak-round2t123 backup for rollback.
#
# Usage:
#   cd /Users/pablocosta/Desktop/terraform/GitHub/superdoc
#   python3 round2_task_1_2_3.py                  # edits + build + plan only
#   python3 round2_task_1_2_3.py --skip-build     # edits + plan, no zip rebuild
#   python3 round2_task_1_2_3.py --apply          # everything + terraform apply
#   python3 round2_task_1_2_3.py --apply --skip-build
#   python3 round2_task_1_2_3.py --rollback       # restore .bak files and exit
# =============================================================================

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path


# ---- Configuration -----------------------------------------------------------

REPO_ROOT = Path.cwd()
BACKUP_SUFFIX = ".bak-round2t123"
LAMBDA_ZIPS_BUCKET = "superdoc-lambda-zips-288854271409"
API_GATEWAY_ID = "g590x2ydn4"
API_STAGE = "dev"
API_BASE = "https://" + API_GATEWAY_ID + ".execute-api.us-east-1.amazonaws.com/" + API_STAGE
TFPLAN_NAME = "round2-t123.tfplan"


# ---- Logging -----------------------------------------------------------------

def log(level: str, msg: str) -> None:
    colors = {"info": "\033[36m", "ok": "\033[32m", "warn": "\033[33m", "err": "\033[31m"}
    reset = "\033[0m"
    color = colors.get(level, "")
    print(f"{color}[round2-t123:{level}]{reset} {msg}", flush=True)


def info(msg): log("info", msg)
def ok(msg):   log("ok", msg)
def warn(msg): log("warn", msg)
def err(msg):  log("err", msg)


# ---- File helpers ------------------------------------------------------------

def ensure_backup(path: Path) -> None:
    # First-time backup only. Re-runs must preserve pre-script state.
    bak = path.with_suffix(path.suffix + BACKUP_SUFFIX)
    if not bak.exists():
        shutil.copy2(path, bak)


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def create_or_skip(path: Path, content: str, label: str) -> None:
    # Idempotent create. If file already matches content exactly, no-op.
    # If file exists with different content, backs up first.
    if path.exists():
        if path.read_text() == content:
            info(f"  {label} already up-to-date")
            return
        ensure_backup(path)
    write_file(path, content)
    ok(f"  created {label}")


# ---- File content templates --------------------------------------------------

OPERATIONS_PY_NEW = '''from __future__ import annotations

from dataclasses import dataclass


# Structured catalog of operations offered by SuperDoc.
#
# Why this shape:
#   - The frontend's operation picker needs to know which operations accept a
#     given input type (e.g. "I just dropped a PDF - what can I do?"). A flat
#     dict of op -> lambda_suffix (the old shape) doesn't carry that info.
#   - Keeping label/category here means adding a new op is one place to edit:
#     this dict + the handler + Terraform module. No frontend change needed.
#   - output_type drives download naming on the frontend.
OPERATIONS: dict[str, dict] = {
    "pdf_compress": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "optimize",
        "label": "Compress PDF",
        "lambda_suffix": "pdf-compress",
    },
    "pdf_merge": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Merge PDFs",
        "lambda_suffix": "pdf-merge",
    },
    "pdf_split": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Split PDF",
        "lambda_suffix": "pdf-split",
    },
    "pdf_to_docx": {
        "input_types": ["pdf"],
        "output_type": "docx",
        "category": "convert",
        "label": "PDF to Word (.docx)",
        "lambda_suffix": "pdf-to-docx",
    },
    "pdf_to_txt": {
        "input_types": ["pdf"],
        "output_type": "txt",
        "category": "convert",
        "label": "PDF to Text (.txt)",
        "lambda_suffix": "pdf-to-txt",
    },
    "pdf_rotate": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Rotate PDF pages",
        "lambda_suffix": "pdf-rotate",
    },
    "pdf_annotate": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Add watermark to PDF",
        "lambda_suffix": "pdf-annotate",
    },
    "pdf_extract_text": {
        "input_types": ["pdf"],
        "output_type": "json",
        "category": "extract",
        "label": "Extract structured text (JSON)",
        "lambda_suffix": "pdf-extract-text",
    },
    "image_convert": {
        "input_types": ["png", "jpg", "jpeg", "webp", "gif"],
        "output_type": "image",
        "category": "convert",
        "label": "Convert image format",
        "lambda_suffix": "image-convert",
    },
    "doc_edit": {
        "input_types": ["docx", "xlsx"],
        "output_type": "same",
        "category": "edit",
        "label": "Edit document content",
        "lambda_suffix": "doc-edit",
    },
    "video_process": {
        "input_types": ["mp4", "mov", "avi", "mkv", "webm"],
        "output_type": "mp4",
        "category": "convert",
        "label": "Process video",
        "lambda_suffix": "video-process",
    },
}


# Kept alongside OPERATIONS so dispatcher code that only needs the suffix
# lookup doesn't have to reach into the full metadata dict. Consumers stay
# simple; the map is just a projection of OPERATIONS built once at import.
OPERATION_FUNCTION_SUFFIX: dict[str, str] = {}
for _op, _meta in OPERATIONS.items():
    OPERATION_FUNCTION_SUFFIX[_op] = _meta["lambda_suffix"]


def is_supported(operation: str) -> bool:
    """Return whether operation is a known operation id.

    Used by create_job to reject unknown operations. Kept as a dedicated
    function (not inline `op in OPERATIONS`) so callers don't couple to the
    dict structure - storage can change later without breaking create_job.
    """
    return operation in OPERATIONS


def list_operations(input_type: str | None = None) -> list[dict]:
    """Return the public-facing catalog, optionally filtered by input type.

    This is what the GET /operations endpoint returns. lambda_suffix is
    stripped from the response: that's an internal implementation detail
    and exposing Lambda function names would hint at our infrastructure
    to anyone scanning the API.
    """
    ext = None
    if input_type is not None:
        ext = input_type.lower().lstrip(".")

    results: list[dict] = []
    for op, meta in OPERATIONS.items():
        if ext is not None and ext not in meta["input_types"]:
            continue
        results.append({
            "operation": op,
            "label": meta["label"],
            "category": meta["category"],
            "input_types": meta["input_types"],
            "output_type": meta["output_type"],
        })
    return results


@dataclass(frozen=True)
class ValidationResult:
    """Returned by validate_params. Frozen so callers can\'t mutate it
    accidentally after it leaves the validation layer."""

    ok: bool
    error: str = ""
    params: dict | None = None


def _limit_str(value: object, *, name: str, max_len: int) -> tuple[bool, str]:
    """Validate that value is either None or a string up to max_len chars.

    Returns (ok, error_message). Split out of validate_params to keep the
    per-op branches readable and to allow reuse. The two-tuple return acts
    as a tiny result type - we avoid raising inside the hot validation path
    because raising is slower than returning in CPython.
    """
    if value is None:
        return True, ""
    if not isinstance(value, str):
        return False, f"{name} must be a string"
    if len(value) > max_len:
        return False, f"{name} is too long (max {max_len})"
    return True, ""


def _one_of(value: object, *, name: str, allowed: set[str]) -> tuple[bool, str]:
    """Validate that value is either None or one of allowed (case-insensitive)."""
    if value is None:
        return True, ""
    if not isinstance(value, str):
        return False, f"{name} must be a string"
    allowed_lower: set[str] = set()
    for item in allowed:
        allowed_lower.add(item.lower())
    if value.lower() not in allowed_lower:
        return False, f"{name} must be one of: {\', \'.join(sorted(allowed))}"
    return True, ""


def validate_params(operation: str, params: dict | None) -> ValidationResult:
    """Whitelist-validate params for operation.

    Unknown keys are silently dropped - this prevents clients from smuggling
    arbitrary payload into worker Lambdas through fields the workers don\'t
    expect. Security-by-default.
    """
    if not params:
        return ValidationResult(ok=True, params={})

    if not isinstance(params, dict):
        return ValidationResult(ok=False, error="params must be an object")

    cleaned: dict = {}

    if operation == "pdf_annotate":
        ok_flag, err_msg = _limit_str(params.get("watermark_text"), name="watermark_text", max_len=120)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("watermark_text") is not None:
            cleaned["watermark_text"] = params.get("watermark_text")

    if operation == "image_convert":
        ok_flag, err_msg = _one_of(
            params.get("target_format"),
            name="target_format",
            allowed={"png", "jpg", "jpeg", "webp", "gif"},
        )
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("target_format") is not None:
            cleaned["target_format"] = params.get("target_format")

    if operation == "doc_edit":
        # docx find/replace
        ok_flag, err_msg = _limit_str(params.get("find_text"), name="find_text", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        ok_flag, err_msg = _limit_str(params.get("replace_text"), name="replace_text", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("find_text") is not None:
            cleaned["find_text"] = params.get("find_text")
        if params.get("replace_text") is not None:
            cleaned["replace_text"] = params.get("replace_text")

        # xlsx set-cell
        ok_flag, err_msg = _limit_str(params.get("sheet"), name="sheet", max_len=64)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        ok_flag, err_msg = _limit_str(params.get("cell"), name="cell", max_len=10)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        ok_flag, err_msg = _limit_str(params.get("value"), name="value", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("sheet") is not None:
            cleaned["sheet"] = params.get("sheet")
        if params.get("cell") is not None:
            cleaned["cell"] = params.get("cell")
        if params.get("value") is not None:
            cleaned["value"] = params.get("value")

    # Unknown keys silently dropped per the docstring.
    return ValidationResult(ok=True, params=cleaned)
'''


LIST_OPERATIONS_PY = '''# handlers/list_operations.py - GET /operations
#
# Read-only endpoint that exposes the operation catalog to the frontend.
# Deliberately minimal: no DB, no S3, no auth. The Lambda\'s IAM role reflects
# this via the (still over-granted) default module profile - see TODO in
# infra/main.tf.

import operations
import response
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    """API Gateway AWS_PROXY handler for GET /operations[?input_type=<ext>].

    Catches broad Exception and returns 500 because raising would leak into
    API Gateway as the DEFAULT_5XX gateway response (the same failure we
    spent hours on in Round 1). A controlled JSON error is friendlier to
    the frontend - it can surface a toast instead of a broken screen.
    """
    if event.get("httpMethod") == "OPTIONS":
        return response.preflight()

    try:
        qs = event.get("queryStringParameters")
        input_type = None
        if qs is not None:
            raw = qs.get("input_type")
            if raw is not None:
                stripped = raw.strip()
                if stripped != "":
                    input_type = stripped

        ops = operations.list_operations(input_type=input_type)
        return response.ok({"operations": ops, "count": len(ops)})

    except Exception as exc:
        log.exception("list_operations error: %s", exc)
        return response.error("Internal error", 500)
'''


PDF_TO_TXT_PY = r'''# handlers/pdf_to_txt.py - Worker Lambda for pdf_to_txt operation.
#
# Reads a PDF from S3, extracts plain text per page, joins with form-feed,
# writes back as .txt. Deliberately does NOT reuse pdf_extract_text because
# that one emits JSON with page structure - here we want a user-facing plain
# text file the user can open in any editor.
#
# Pages are separated by \f (form feed, U+000C) - a long-standing convention
# for plain-text-from-PDF that text readers like less(1) honor as a page break.

import io
import json as _json

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader

log = get_logger(__name__)


def _extract_plain_text(pdf_bytes: bytes) -> bytes:
    """Extract page-by-page plain text from PDF bytes.

    Split into its own function so it can be unit-tested without the SQS
    event / DynamoDB / S3 ceremony. The I/O-free core is the interesting
    part; everything else is glue.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    page_texts: list[str] = []
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted is None:
            page_texts.append("")
        else:
            page_texts.append(extracted)
    return "\f".join(page_texts).encode("utf-8")


def handler(event, context):
    """SQS-triggered worker. Consumes one message, writes output to S3.

    Errors are re-raised after marking the job FAILED in DynamoDB so that
    SQS retries (or dead-letters) based on queue config. We do NOT swallow
    the exception - that would confuse SQS into thinking the message was
    processed successfully.
    """
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _extract_plain_text(data)
        out_key = s3.make_output_key(job_id, file_key, "output.txt")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_txt done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_txt failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
'''


LAMBDA_LIST_OPERATIONS_TF = '''
# Read-only Lambda for GET /operations. Minimal memory/timeout since it
# returns a static dict. The lambda module still attaches DynamoDB/S3
# policies by default - known over-grant. Accepted for now because fixing
# the module is out of scope; the blast radius is bounded because the
# handler code never uses those permissions.
# TODO(round-2.5): add disable_dynamodb_access / disable_s3_access flags
# to modules/lambda and set them true here.
module "lambda_list_operations" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "list-operations"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 5
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/list_operations.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}
'''


LAMBDA_PDF_TO_TXT_TF = '''
# Worker Lambda for pdf_to_txt. Matches pdf_extract_text\'s shape (256MB,
# 120s timeout) because the underlying pypdf work is identical.
module "lambda_pdf_to_txt" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-txt"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_to_txt.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}
'''


OPERATIONS_ROUTE_TF = '''
# -- /operations -------------------------------------------------------------
# GET /operations returns the operation catalog; OPTIONS handles CORS preflight.
# Public endpoint (no auth) because the catalog contains no secrets.

resource "aws_api_gateway_resource" "operations" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "operations"
}

resource "aws_api_gateway_method" "operations_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.operations.id
  http_method   = "GET"
  authorization = "NONE"

  request_parameters = {
    "method.request.querystring.input_type" = false
  }
}

resource "aws_api_gateway_integration" "operations_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.operations.id
  http_method             = aws_api_gateway_method.operations_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["list_operations"].invoke_arn
}

# Permission is scoped to this specific API Gateway. Uses local.api_execution_arn
# (explicitly built from account + region + api id) instead of
# aws_api_gateway_rest_api.superdoc.execution_arn because the provider has a
# drift bug in execution_arn - see Round 1 troubleshooting.
resource "aws_lambda_permission" "list_operations" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["list_operations"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "operations_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_get.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "operations_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.operations.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "operations_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\\"statusCode\\": 200}"
  }
}

resource "aws_api_gateway_method_response" "operations_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "operations_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "\'*\'"
    "method.response.header.Access-Control-Allow-Headers" = "\'Content-Type,Authorization,X-Api-Key\'"
    "method.response.header.Access-Control-Allow-Methods" = "\'GET,POST,DELETE,OPTIONS\'"
  }

  # depends_on defensively prevents the race we hit in the first deploy
  # where integration_response ran before its method_response/integration
  # existed - see Round 1 handoff for details.
  depends_on = [
    aws_api_gateway_integration.operations_options,
    aws_api_gateway_method_response.operations_options_200,
  ]
}
'''


# ---- Steps -------------------------------------------------------------------

def step_refactor_operations_py() -> None:
    info("Task 1: Refactor layers/superdoc_utils/operations.py")
    path = REPO_ROOT / "layers/superdoc_utils/operations.py"
    if not path.exists():
        raise RuntimeError(f"{path} not found")
    ensure_backup(path)
    write_file(path, OPERATIONS_PY_NEW)
    ok(f"  rewrote {path.relative_to(REPO_ROOT)}")

    # Verify catalog + core fns are present after rewrite.
    content = path.read_text()
    missing: list[str] = []
    if "OPERATIONS: dict" not in content:
        missing.append("OPERATIONS catalog")
    if "def list_operations" not in content:
        missing.append("list_operations()")
    if "def is_supported" not in content:
        missing.append("is_supported()")
    if "def validate_params" not in content:
        missing.append("validate_params()")
    if len(missing) > 0:
        raise RuntimeError(f"operations.py missing after rewrite: {missing}")


def step_create_handlers() -> None:
    info("Task 2: Create handlers/list_operations.py")
    create_or_skip(
        REPO_ROOT / "handlers/list_operations.py",
        LIST_OPERATIONS_PY,
        "handlers/list_operations.py",
    )

    info("Task 3: Create handlers/pdf_to_txt.py")
    create_or_skip(
        REPO_ROOT / "handlers/pdf_to_txt.py",
        PDF_TO_TXT_PY,
        "handlers/pdf_to_txt.py",
    )


def _find_matching_close_brace(src: str, header_at: int) -> int:
    # Walk character-by-character from the first `{` after the header,
    # tracking depth until depth returns to 0. Used for inserting an entry
    # into a Terraform map block like `lambda_integrations = { ... }`.
    first_open = src.find("{", header_at)
    if first_open < 0:
        raise RuntimeError("open brace not found after header")

    depth = 0
    cursor = first_open
    while cursor < len(src):
        ch = src[cursor]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return cursor
        cursor += 1
    raise RuntimeError("unmatched opening brace - malformed terraform file")


def step_wire_lambdas_in_main_tf() -> None:
    info("Tasks 2+3: wire new Lambdas in infra/main.tf")
    path = REPO_ROOT / "infra/main.tf"
    if not path.exists():
        raise RuntimeError(f"{path} not found")

    src = path.read_text()
    anchor_pattern = re.compile(
        r'module\s+"lambda_pdf_extract_text"\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}',
        re.DOTALL,
    )

    # Insert lambda_list_operations module, idempotent via sentinel.
    if 'module "lambda_list_operations"' in src:
        info("  infra/main.tf: lambda_list_operations already present")
    else:
        match = anchor_pattern.search(src)
        if match is None:
            raise RuntimeError("anchor lambda_pdf_extract_text not found in main.tf")
        ensure_backup(path)
        src = src[:match.end()] + LAMBDA_LIST_OPERATIONS_TF + src[match.end():]
        ok("  inserted lambda_list_operations module")

    # Insert lambda_pdf_to_txt module.
    if 'module "lambda_pdf_to_txt"' in src:
        info("  infra/main.tf: lambda_pdf_to_txt already present")
    else:
        match = anchor_pattern.search(src)
        if match is None:
            raise RuntimeError("anchor lambda_pdf_extract_text vanished after first insert")
        ensure_backup(path)
        src = src[:match.end()] + LAMBDA_PDF_TO_TXT_TF + src[match.end():]
        ok("  inserted lambda_pdf_to_txt module")

    # Register list_operations in api_gateway.lambda_integrations map.
    if re.search(r"\blist_operations\s*=\s*\{", src):
        info("  infra/main.tf: list_operations entry already in lambda_integrations")
    else:
        header_at = src.find("lambda_integrations = {")
        if header_at < 0:
            raise RuntimeError("lambda_integrations block not found in main.tf")
        close_at = _find_matching_close_brace(src, header_at)
        entry_block = (
            "    list_operations = {\n"
            "      invoke_arn    = module.lambda_list_operations.invoke_arn\n"
            "      function_name = module.lambda_list_operations.function_name\n"
            "    }\n"
            "  "
        )
        ensure_backup(path)
        src = src[:close_at] + entry_block + src[close_at:]
        ok("  added list_operations to lambda_integrations")

    # Grant dispatch_job permission to invoke pdf_to_txt.
    if "module.lambda_pdf_to_txt.function_arn" in src:
        info("  infra/main.tf: pdf_to_txt ARN already in dispatcher IAM")
    else:
        pattern = re.compile(r'module\.lambda_pdf_to_docx\.function_arn,')
        match = pattern.search(src)
        if match is None:
            warn(
                "could not find pdf_to_docx ARN in dispatcher policy - "
                "manually add module.lambda_pdf_to_txt.function_arn to "
                "dispatch_job.extra_iam_statements"
            )
        else:
            ensure_backup(path)
            src = (
                src[:match.end()]
                + "\n        module.lambda_pdf_to_txt.function_arn,"
                + src[match.end():]
            )
            ok("  added pdf_to_txt ARN to dispatch_job IAM statements")

    path.write_text(src)


def step_wire_operations_route() -> None:
    info("Task 2: add /operations route in api_gateway module")
    path = REPO_ROOT / "infra/modules/api_gateway/main.tf"
    if not path.exists():
        raise RuntimeError(f"{path} not found")

    src = path.read_text()

    # Insert the route block before the deployment resource so the deployment's
    # depends_on can reference the new resources.
    if 'aws_api_gateway_resource" "operations"' in src:
        info("  /operations resources already present")
    else:
        deployment_idx = src.find('resource "aws_api_gateway_deployment" "superdoc"')
        if deployment_idx < 0:
            raise RuntimeError("deployment block not found in api_gateway/main.tf")
        ensure_backup(path)
        src = src[:deployment_idx] + OPERATIONS_ROUTE_TF + "\n\n" + src[deployment_idx:]
        ok("  inserted /operations route block")
        path.write_text(src)

    # Re-read after potential first-pass rewrite.
    src = path.read_text()

    # Add /operations ids to deployment.triggers so terraform actually creates
    # a new deployment. Without this the stage keeps serving the old deployment
    # (exactly the failure mode from Round 1).
    if "aws_api_gateway_integration.operations_get.id" in src:
        info("  /operations ids already in deployment triggers")
    else:
        triggers_match = re.search(
            r"redeployment\s*=\s*sha1\(jsonencode\(\[",
            src,
        )
        if triggers_match is None:
            warn("deployment triggers block not found - manual fix needed")
        else:
            injection = (
                "\n      aws_api_gateway_resource.operations.id,"
                "\n      aws_api_gateway_method.operations_get.id,"
                "\n      aws_api_gateway_integration.operations_get.id,"
            )
            ensure_backup(path)
            src = src[:triggers_match.end()] + injection + src[triggers_match.end():]
            path.write_text(src)
            ok("  added /operations ids to deployment triggers")

    # Add /operations dependencies to deployment.depends_on so apply-ordering
    # is correct (integrations must exist before the deployment references them).
    src = path.read_text()
    if "aws_api_gateway_integration.operations_get," in src:
        info("  /operations already in deployment depends_on")
    else:
        depends_match = re.search(
            r"depends_on\s*=\s*\[\s*\n\s*aws_api_gateway_integration\.health_mock,",
            src,
        )
        if depends_match is None:
            warn("deployment depends_on block not found - manual fix needed")
        else:
            injection = (
                "\n    aws_api_gateway_integration.operations_get,"
                "\n    aws_api_gateway_integration_response.operations_options_200,"
            )
            ensure_backup(path)
            src = src[:depends_match.end()] + injection + src[depends_match.end():]
            path.write_text(src)
            ok("  added /operations to deployment depends_on")


def step_build_handlers(skip: bool) -> None:
    if skip:
        info("build: --skip-build set, skipping handler packaging + upload")
        return
    info("build: packaging handlers and uploading to S3")
    env = os.environ.copy()
    env["LAMBDA_ZIPS_BUCKET"] = LAMBDA_ZIPS_BUCKET
    result = subprocess.run(
        ["bash", "scripts/build_handlers.sh"],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"build_handlers.sh failed (rc={result.returncode})\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    ok("  build + upload complete")


def step_terraform_plan() -> None:
    info(f"terraform plan -> {TFPLAN_NAME}")
    result = subprocess.run(
        [
            "terraform",
            "-chdir=infra/environments/dev",
            "plan",
            f"-var=lambda_handler_s3_bucket={LAMBDA_ZIPS_BUCKET}",
            f"-out={TFPLAN_NAME}",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"terraform plan failed (rc={result.returncode})\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    ok(f"  plan saved to infra/environments/dev/{TFPLAN_NAME}")


def step_terraform_apply() -> None:
    info("terraform apply")
    result = subprocess.run(
        [
            "terraform",
            "-chdir=infra/environments/dev",
            "apply",
            TFPLAN_NAME,
        ],
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"terraform apply failed (rc={result.returncode})")
    ok("  apply complete")


def step_force_redeploy() -> None:
    # Belt-and-suspenders: terraform deployment trigger SHOULD have fired, but
    # Round 1 taught us not to trust it. Explicit create-deployment costs nothing.
    info("force API Gateway stage redeploy")
    result = subprocess.run(
        [
            "aws", "apigateway", "create-deployment",
            "--rest-api-id", API_GATEWAY_ID,
            "--stage-name", API_STAGE,
            "--description", "Round 2 T1-3: /operations route + pdf_to_txt",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"aws apigateway create-deployment failed (rc={result.returncode})\n"
            f"stderr:\n{result.stderr}"
        )
    ok("  stage redeployed")


def _fetch_json_with_retry(url: str, attempts: int, backoff_seconds: int) -> dict:
    # Retry wrapper around curl. API Gateway propagation after create-deployment
    # can take a few seconds; we don't want transient lag to fail the script.
    # curl is used instead of `requests` so we don't depend on a pip install.
    last_error = ""
    for attempt_num in range(1, attempts + 1):
        result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", url],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            last_error = f"curl rc={result.returncode}: {result.stderr}"
        else:
            parts = result.stdout.rsplit("\n", 1)
            if len(parts) == 2:
                body, http_code = parts
                if http_code.strip() == "200":
                    try:
                        return json.loads(body)
                    except json.JSONDecodeError as exc:
                        last_error = f"JSON decode error: {exc}; body={body[:200]}"
                else:
                    last_error = f"HTTP {http_code}: {body[:200]}"
            else:
                last_error = f"unexpected curl output: {result.stdout[:200]}"

        if attempt_num < attempts:
            warn(f"  attempt {attempt_num}/{attempts} failed ({last_error}); retrying in {backoff_seconds}s")
            time.sleep(backoff_seconds)

    raise RuntimeError(f"smoke test failed after {attempts} attempts against {url}: {last_error}")


def step_smoke_test() -> None:
    info("smoke: GET /operations and GET /operations?input_type=pdf")
    url_all = f"{API_BASE}/operations"
    url_pdf = f"{API_BASE}/operations?input_type=pdf"

    data_all = _fetch_json_with_retry(url_all, attempts=4, backoff_seconds=3)
    data_pdf = _fetch_json_with_retry(url_pdf, attempts=4, backoff_seconds=3)

    total = data_all.get("count", 0)
    if total < 1:
        raise RuntimeError(f"GET /operations returned empty catalog: {data_all}")

    pdf_ops: list[str] = []
    for item in data_pdf.get("operations", []):
        pdf_ops.append(item["operation"])

    if "pdf_to_txt" not in pdf_ops:
        raise RuntimeError(f"pdf_to_txt missing from ?input_type=pdf result: {pdf_ops}")

    ok(f"  /operations returned {total} total, {len(pdf_ops)} for PDF (incl. pdf_to_txt)")


# ---- Rollback ----------------------------------------------------------------

def perform_rollback() -> None:
    # Restore every .bak-round2t123 to its original path. Does not touch
    # terraform state, AWS, or uploaded zips - it's file-level only. Suffix
    # is script-specific so there's no risk of clobbering unrelated state.
    restored = 0
    for bak in REPO_ROOT.rglob(f"*{BACKUP_SUFFIX}"):
        # bak path is like `operations.py.bak-round2t123`;
        # .with_suffix("") strips only the last extension.
        original = bak.with_suffix("")
        shutil.copy2(bak, original)
        bak.unlink()
        ok(f"  restored {original.relative_to(REPO_ROOT)}")
        restored += 1

    if restored == 0:
        warn("no backups found - nothing to roll back")
    else:
        ok(f"rolled back {restored} file(s)")


# ---- Sanity checks -----------------------------------------------------------

def ensure_repo_root() -> None:
    # Abort if we're not at the SuperDoc repo root. The markers below are
    # specific enough that false positives are effectively impossible.
    required = [
        REPO_ROOT / "handlers",
        REPO_ROOT / "layers/superdoc_utils",
        REPO_ROOT / "infra/main.tf",
        REPO_ROOT / "infra/modules/api_gateway/main.tf",
        REPO_ROOT / "scripts/build_handlers.sh",
    ]
    missing = []
    for marker in required:
        if not marker.exists():
            missing.append(str(marker.relative_to(REPO_ROOT)))
    if len(missing) > 0:
        err(f"not at SuperDoc repo root (missing: {missing})")
        err(f"cwd={REPO_ROOT}")
        sys.exit(2)


# ---- Main --------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Round 2 Tasks 1-3: operations catalog + endpoint + pdf_to_txt",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="run terraform apply + redeploy stage + smoke test (default: plan only)",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="don't package/upload handler zips",
    )
    parser.add_argument(
        "--skip-plan",
        action="store_true",
        help="don't run terraform plan",
    )
    parser.add_argument(
        "--rollback",
        action="store_true",
        help="restore all files from their .bak-round2t123 backups and exit",
    )
    args = parser.parse_args()

    if args.rollback:
        ensure_repo_root()
        perform_rollback()
        return

    ensure_repo_root()

    try:
        step_refactor_operations_py()
        step_create_handlers()
        step_wire_lambdas_in_main_tf()
        step_wire_operations_route()
        step_build_handlers(skip=args.skip_build)
        if not args.skip_plan:
            step_terraform_plan()
        if args.apply:
            step_terraform_apply()
            step_force_redeploy()
            step_smoke_test()
    except Exception as exc:
        err("")
        err("=" * 72)
        err(f"SCRIPT FAILED: {exc}")
        err("")
        err("To undo file edits:")
        err(f"  python3 {sys.argv[0]} --rollback")
        sys.exit(1)

    info("")
    info("=" * 72)
    ok("SUCCESS")
    if not args.apply:
        info("")
        info("Plan only. Inspect then apply with:")
        info(f"  terraform -chdir=infra/environments/dev show {TFPLAN_NAME} | less")
        info(f"  python3 {sys.argv[0]} --apply --skip-build")


if __name__ == "__main__":
    main()
