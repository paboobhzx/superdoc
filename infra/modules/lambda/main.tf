# Tracks S3 object etag so Terraform detects code changes automatically
data "aws_s3_object" "handler_zip" {
  count  = var.package_type == "Zip" ? 1 : 0
  bucket = var.s3_bucket
  key    = var.s3_key
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-${var.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.common_tags
}

# Basic Lambda execution (CloudWatch logs only)
resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Scoped DynamoDB access
resource "aws_iam_role_policy" "dynamodb" {
  name = "${var.name_prefix}-${var.function_name}-dynamo"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DeleteItem"
      ]
      Resource = var.dynamodb_table_arns
    }]
  })
}

# Scoped S3 access — uploads/, outputs/, tmp/ only
resource "aws_iam_role_policy" "s3" {
  name = "${var.name_prefix}-${var.function_name}-s3"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ]
      Resource = [
        "${var.media_bucket_arn}/uploads/*",
        "${var.media_bucket_arn}/outputs/*",
        "${var.media_bucket_arn}/users/*",
        "${var.media_bucket_arn}/tmp/*",
        "${var.media_bucket_arn}/incidents/*"
      ]
    }]
  })
}

# SSM read access for secrets and feature flags
resource "aws_iam_role_policy" "ssm" {
  name = "${var.name_prefix}-${var.function_name}-ssm"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"]
      Resource = "arn:aws:ssm:*:*:parameter/superdoc/*"
    }]
  })
}

# Optional extra IAM statements (for SNS publish, CloudWatch, API GW, etc.)
resource "aws_iam_role_policy" "extra" {
  count = length(var.extra_iam_statements) > 0 ? 1 : 0
  name  = "${var.name_prefix}-${var.function_name}-extra"
  role  = aws_iam_role.lambda.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = var.extra_iam_statements
  })
}

resource "aws_lambda_function" "this" {
  function_name                  = "${var.name_prefix}-${var.function_name}"
  role                           = aws_iam_role.lambda.arn
  package_type                   = var.package_type
  handler                        = var.package_type == "Zip" ? var.handler : null
  runtime                        = var.package_type == "Zip" ? var.runtime : null
  image_uri                      = var.package_type == "Image" ? var.image_uri : null
  memory_size                    = var.memory_size
  timeout                        = var.timeout
  architectures                  = length(var.architectures) > 0 ? var.architectures : null
  s3_bucket                      = var.package_type == "Zip" ? var.s3_bucket : null
  s3_key                         = var.package_type == "Zip" ? var.s3_key : null
  layers                         = var.package_type == "Zip" && length(var.layer_arns) > 0 ? var.layer_arns : null
  reserved_concurrent_executions = var.reserved_concurrent_executions >= 0 ? var.reserved_concurrent_executions : null
  source_code_hash               = var.package_type == "Zip" ? data.aws_s3_object.handler_zip[0].etag : null
  tags                           = var.common_tags

  environment {
    variables = var.environment_variables
  }

  tracing_config {
    mode = "PassThrough"
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${aws_lambda_function.this.function_name}"
  retention_in_days = 7
  tags              = var.common_tags
}

# ── Optional EventBridge schedule (kb_cleanup, restore_anonymous) ────────────

resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.enable_eventbridge ? 1 : 0
  name                = "${var.name_prefix}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
  tags                = var.common_tags
}

resource "aws_cloudwatch_event_target" "schedule" {
  count     = var.enable_eventbridge ? 1 : 0
  rule      = aws_cloudwatch_event_rule.schedule[0].name
  target_id = "${var.function_name}-target"
  arn       = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "eventbridge" {
  count         = var.enable_eventbridge ? 1 : 0
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[0].arn
}

# ── Optional SQS event source mapping ────────────────────────────────────────

resource "aws_lambda_event_source_mapping" "sqs" {
  count            = var.enable_sqs_trigger ? 1 : 0
  event_source_arn = var.sqs_event_source_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = 1

  dynamic "filter_criteria" {
    for_each = var.sqs_filter_operation != "" ? [1] : []
    content {
      filter {
        pattern = jsonencode({ body = { operation = [var.sqs_filter_operation] } })
      }
    }
  }
}

resource "aws_iam_role_policy" "sqs" {
  count = var.enable_sqs_trigger ? 1 : 0
  name  = "${var.name_prefix}-${var.function_name}-sqs"
  role  = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      Resource = [var.sqs_event_source_arn]
    }]
  })
}

# ── Optional SNS trigger (disable_anonymous) ─────────────────────────────────

resource "aws_sns_topic_subscription" "trigger" {
  count     = var.enable_sns_trigger ? 1 : 0
  topic_arn = var.sns_trigger_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "sns" {
  count         = var.enable_sns_trigger ? 1 : 0
  statement_id  = "AllowSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = var.sns_trigger_arn
}
