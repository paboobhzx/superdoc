# ── S3, DynamoDB, SSM ─────────────────────────────────────────────────────────

module "s3" {
  source                      = "./modules/s3"
  name_prefix                 = local.name_prefix
  common_tags                 = local.common_tags
  enable_customer_managed_kms = var.enable_media_customer_managed_kms
  cors_allowed_origins        = var.cors_allowed_origins
}

module "dynamodb" {
  source                      = "./modules/dynamodb"
  name_prefix                 = local.name_prefix
  common_tags                 = local.common_tags
  enable_customer_managed_kms = var.enable_dynamodb_customer_managed_kms
}

module "ssm" {
  source      = "./modules/ssm"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
}

# ── Additional DynamoDB tables ────────────────────────────────────────────────

# Payments table: TTL=24h handles abandoned checkouts without manual cleanup.
# On-demand billing keeps cost at zero when idle.
resource "aws_dynamodb_table" "payments" {
  name         = "${local.name_prefix}-payments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "payment_id"

  attribute {
    name = "payment_id"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = local.common_tags
}

resource "aws_dynamodb_table" "credits_ledger" {
  name         = "${local.name_prefix}-credits-ledger"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "event_id"

  attribute {
    name = "event_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "N"
  }

  global_secondary_index {
    name            = "user-created-at-index"
    hash_key        = "user_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  tags = local.common_tags
}

resource "aws_dynamodb_table" "credits_balances" {
  name         = "${local.name_prefix}-credits-balances"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }

  tags = local.common_tags
}

resource "aws_dynamodb_table" "user_settings" {
  name         = "${local.name_prefix}-user-settings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  tags         = local.common_tags

  attribute {
    name = "user_id"
    type = "S"
  }
}
