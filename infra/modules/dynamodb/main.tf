# ── Jobs table ────────────────────────────────────────────────────────────────

resource "aws_kms_key" "dynamodb" {
  count                   = var.enable_customer_managed_kms ? 1 : 0
  description             = "${var.name_prefix} DynamoDB table encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.common_tags
}

resource "aws_kms_alias" "dynamodb" {
  count         = var.enable_customer_managed_kms ? 1 : 0
  name          = "alias/${var.name_prefix}-dynamodb"
  target_key_id = aws_kms_key.dynamodb[0].key_id
}

resource "aws_dynamodb_table" "jobs" {
  name         = "${var.name_prefix}-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"
  tags         = var.common_tags

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "session_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "session-index"
    hash_key        = "session_id"
    range_key       = "status"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "user-history-index"
    hash_key        = "user_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.enable_customer_managed_kms ? aws_kms_key.dynamodb[0].arn : null
  }
}

# ── API Keys table ───────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "api_keys" {
  name         = "${var.name_prefix}-api-keys"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "key_hash"
  tags         = var.common_tags

  attribute {
    name = "key_hash"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  global_secondary_index {
    name            = "user-keys-index"
    hash_key        = "user_id"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.enable_customer_managed_kms ? aws_kms_key.dynamodb[0].arn : null
  }
}

# ── Incidents table ──────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "incidents" {
  name         = "${var.name_prefix}-incidents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "incident_id"
  range_key    = "timestamp"
  tags         = var.common_tags

  attribute {
    name = "incident_id"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.enable_customer_managed_kms ? aws_kms_key.dynamodb[0].arn : null
  }
}

# ── Rate Limits table ────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "rate_limits" {
  name         = "${var.name_prefix}-rate-limits"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "key"
  tags         = var.common_tags

  attribute {
    name = "key"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.enable_customer_managed_kms ? aws_kms_key.dynamodb[0].arn : null
  }
}

# ── Auth Sessions table ─────────────────────────────────────────────────────

resource "aws_dynamodb_table" "auth_sessions" {
  name         = "${var.name_prefix}-auth-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id_hash"
  tags         = var.common_tags

  attribute {
    name = "session_id_hash"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.enable_customer_managed_kms ? aws_kms_key.dynamodb[0].arn : null
  }
}
