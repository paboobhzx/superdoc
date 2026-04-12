# SSM parameters — values set out-of-band (CLI or CI), never real values in Terraform.
# This module creates the parameters with PLACEHOLDER values and ignores future changes.
#
# Feature flags:
#   aws ssm put-parameter --name "/superdoc/features/anonymous_ops_enabled" --value "true" --type String --overwrite
#   aws ssm put-parameter --name "/superdoc/features/maintenance_mode" --value "false" --type String --overwrite
#
# Secrets:
#   aws ssm put-parameter --name "/superdoc/stripe/webhook_secret" --value "whsec_xxx" --type SecureString
#   aws ssm put-parameter --name "/superdoc/stripe/secret_key" --value "sk_live_xxx" --type SecureString

# ── Feature flags (String, free tier) ────────────────────────────────────────

resource "aws_ssm_parameter" "anonymous_ops_enabled" {
  name  = "/${var.name_prefix}/features/anonymous_ops_enabled"
  type  = "String"
  value = "true"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "maintenance_mode" {
  name  = "/${var.name_prefix}/features/maintenance_mode"
  type  = "String"
  value = "false"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "registrations_enabled" {
  name  = "/${var.name_prefix}/features/registrations_enabled"
  type  = "String"
  value = "true"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "video_processing_enabled" {
  name  = "/${var.name_prefix}/features/video_processing_enabled"
  type  = "String"
  value = "true"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}

# ── Secrets (SecureString, free Standard tier) ───────────────────────────────

resource "aws_ssm_parameter" "stripe_webhook_secret" {
  name  = "/${var.name_prefix}/stripe/webhook_secret"
  type  = "SecureString"
  value = "PLACEHOLDER"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "stripe_secret_key" {
  name  = "/${var.name_prefix}/stripe/secret_key"
  type  = "SecureString"
  value = "PLACEHOLDER"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "bedrock_kb_id" {
  name  = "/${var.name_prefix}/bedrock/knowledge_base_id"
  type  = "String"
  value = "PLACEHOLDER"
  tags  = var.common_tags
  lifecycle { ignore_changes = [value] }
}
