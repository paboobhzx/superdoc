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
  function_name = "${var.name_prefix}-${var.function_name}"
  role          = aws_iam_role.lambda.arn
  handler       = var.handler
  runtime       = var.runtime
  memory_size   = var.memory_size
  timeout       = var.timeout
  s3_bucket     = var.s3_bucket
  s3_key        = var.s3_key
  tags          = var.common_tags

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
