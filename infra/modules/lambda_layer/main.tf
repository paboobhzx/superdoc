data "aws_s3_object" "layer_zip" {
  bucket = var.s3_bucket
  key    = var.s3_key
}

resource "aws_lambda_layer_version" "this" {
  layer_name          = "${var.name_prefix}-${var.layer_name}"
  s3_bucket           = var.s3_bucket
  s3_key              = var.s3_key
  source_code_hash    = data.aws_s3_object.layer_zip.etag
  compatible_runtimes = var.compatible_runtimes

  lifecycle {
    create_before_destroy = true
  }
}
