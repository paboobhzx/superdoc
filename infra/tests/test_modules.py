"""
Terraform module validation tests.
Run: pytest infra/tests/test_modules.py -v
Requires: pip install pytest python-hcl2
"""
import os
import glob
import pytest
import hcl2

MODULES_DIR = os.path.join(os.path.dirname(__file__), "..", "modules")
INFRA_DIR   = os.path.join(os.path.dirname(__file__), "..")


def load_hcl(path):
    with open(path, "r") as f:
        return hcl2.load(f)


def all_main_files():
    return glob.glob(os.path.join(MODULES_DIR, "**", "main.tf"), recursive=True)


def all_tf_files():
    return glob.glob(os.path.join(INFRA_DIR, "**", "*.tf"), recursive=True)


# ── Every module must reference common_tags ──────────────────────────────────
@pytest.mark.parametrize("tf_file", all_main_files())
def test_module_references_common_tags(tf_file):
    with open(tf_file) as f:
        content = f.read()
    # Skip modules that are purely data sources (ssm)
    if "data \"aws_" in content and "resource" not in content:
        pytest.skip("Data-only module")
    assert "common_tags" in content or "var.common_tags" in content, (
        f"{tf_file} does not reference common_tags"
    )


# ── No hardcoded AWS account IDs ─────────────────────────────────────────────
@pytest.mark.parametrize("tf_file", all_tf_files())
def test_no_hardcoded_account_ids(tf_file):
    with open(tf_file) as f:
        content = f.read()
    import re
    # AWS account IDs are 12-digit numbers not inside variable references
    matches = re.findall(r'(?<!\$\{)[^a-zA-Z_](\d{12})(?!\})', content)
    assert not matches, (
        f"{tf_file} appears to contain hardcoded AWS account ID: {matches}"
    )


# ── Every S3 bucket must block public access ─────────────────────────────────
def test_s3_blocks_public_access():
    s3_main = os.path.join(MODULES_DIR, "s3", "main.tf")
    with open(s3_main) as f:
        content = f.read()
    assert "block_public_acls" in content
    assert "block_public_policy" in content
    assert "restrict_public_buckets" in content


# ── S3 lifecycle rules exist ─────────────────────────────────────────────────
def test_s3_has_lifecycle_rules():
    s3_main = os.path.join(MODULES_DIR, "s3", "main.tf")
    with open(s3_main) as f:
        content = f.read()
    assert "lifecycle_configuration" in content
    assert "expiration" in content


# ── Lambda module has timeout variable ───────────────────────────────────────
def test_lambda_module_has_timeout():
    lv = os.path.join(MODULES_DIR, "lambda", "variables.tf")
    with open(lv) as f:
        content = f.read()
    assert "timeout" in content


# ── Lambda module has memory_size variable ───────────────────────────────────
def test_lambda_module_has_memory_size():
    lv = os.path.join(MODULES_DIR, "lambda", "variables.tf")
    with open(lv) as f:
        content = f.read()
    assert "memory_size" in content


# ── Lambda IAM roles are scoped (no wildcard actions) ────────────────────────
def test_lambda_iam_no_wildcard_actions():
    lm = os.path.join(MODULES_DIR, "lambda", "main.tf")
    with open(lm) as f:
        content = f.read()
    assert '"*"' not in content.replace('"*/*"', ''), (
        "Lambda IAM policy contains wildcard action — use scoped permissions"
    )


# ── DynamoDB has TTL enabled ──────────────────────────────────────────────────
def test_dynamodb_has_ttl():
    dm = os.path.join(MODULES_DIR, "dynamodb", "main.tf")
    with open(dm) as f:
        content = f.read()
    assert "ttl" in content
    assert "enabled        = true" in content


# ── DynamoDB uses PAY_PER_REQUEST ────────────────────────────────────────────
def test_dynamodb_pay_per_request():
    dm = os.path.join(MODULES_DIR, "dynamodb", "main.tf")
    with open(dm) as f:
        content = f.read()
    assert "PAY_PER_REQUEST" in content


# ── Budget module alert email is set ─────────────────────────────────────────
def test_budget_has_alert():
    bm = os.path.join(MODULES_DIR, "budget", "main.tf")
    with open(bm) as f:
        content = f.read()
    assert "notification" in content
    assert "subscriber_email_addresses" in content


# ── No tfstate files committed ───────────────────────────────────────────────
def test_no_tfstate_in_repo():
    state_files = glob.glob(
        os.path.join(INFRA_DIR, "**", "*.tfstate"), recursive=True
    )
    assert not state_files, f"tfstate files found in repo: {state_files}"


# ── No tfvars files committed (only .example allowed) ────────────────────────
def test_no_tfvars_in_repo():
    tfvars = [
        f for f in glob.glob(
            os.path.join(INFRA_DIR, "**", "*.tfvars"), recursive=True
        )
        if not f.endswith(".example")
    ]
    assert not tfvars, f"tfvars files found in repo: {tfvars}"
