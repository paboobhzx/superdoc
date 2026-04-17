resource "aws_s3_bucket" "media" {
  bucket = "${var.name_prefix}-media-${random_id.suffix.hex}"
  tags   = var.common_tags
}

resource "random_id" "suffix" {
  byte_length = 4
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
      sse_algorithm = "AES256"
    }
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
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
