resource "aws_s3_bucket" "media" {
  bucket = "${var.name_prefix}-media-${random_id.suffix.hex}"
  tags   = var.common_tags
}

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_kms_key" "media" {
  count                   = var.enable_customer_managed_kms ? 1 : 0
  description             = "${var.name_prefix} media bucket encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.common_tags
}

resource "aws_kms_alias" "media" {
  count         = var.enable_customer_managed_kms ? 1 : 0
  name          = "alias/${var.name_prefix}-media"
  target_key_id = aws_kms_key.media[0].key_id
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.enable_customer_managed_kms ? "aws:kms" : "AES256"
      kms_master_key_id = var.enable_customer_managed_kms ? aws_kms_key.media[0].arn : null
    }
    bucket_key_enabled = var.enable_customer_managed_kms
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "delete-uploads-24h"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 1 }
  }

  rule {
    id     = "delete-outputs-24h"
    status = "Enabled"
    filter { prefix = "outputs/" }
    expiration { days = 1 }
  }

  rule {
    id     = "delete-users-uploads-7d"
    status = "Enabled"
    filter { prefix = "users/" }
    expiration { days = 7 }
  }

  rule {
    id     = "delete-tmp-24h"
    status = "Enabled"
    filter { prefix = "tmp/" }
    expiration { days = 1 }
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
