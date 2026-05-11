# ── Stripe SSM parameters ─────────────────────────────────────────────────────
# Replace values in the AWS Systems Manager console when ready to go live.
# lifecycle.ignore_changes on value prevents Terraform from resetting them
# to REPLACE_ME on subsequent applies.

resource "aws_ssm_parameter" "stripe_secret_key" {
  name        = "/superdoc/stripe/secret_key"
  description = "Stripe secret key (sk_live_... or sk_test_...)"
  type        = "SecureString"
  value       = "REPLACE_ME_STRIPE_SECRET_KEY"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_webhook_secret" {
  name        = "/superdoc/stripe/webhook_secret"
  description = "Stripe webhook signing secret (whsec_...)"
  type        = "SecureString"
  value       = "REPLACE_ME_STRIPE_WEBHOOK_SECRET"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_price_id_conversion" {
  name        = "/superdoc/stripe/price_id_conversion"
  description = "Stripe price id for per-conversion charge (price_...)"
  type        = "String"
  value       = "REPLACE_ME_STRIPE_PRICE_ID"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_price_id_credits" {
  name        = "/superdoc/stripe/price_id_credits"
  description = "Stripe price id for credits pack checkout (price_...)"
  type        = "String"
  value       = "REPLACE_ME_STRIPE_CREDITS_PRICE_ID"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}
